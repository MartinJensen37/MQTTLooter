import React from 'react';

/** Capture before React mutates rows; restore the same row and pixel offset after commit. */
export default class StableScrollViewport extends React.Component {
  element = null;
  snapshot = null;
  expectedScrollTop = null;
  pointerKey = null;
  observer = null;

  setElement = (element) => {
    this.element = element;
    if (this.props.viewportRef) this.props.viewportRef.current = element;
  };

  capture(props = this.props) {
    const element = this.element;
    if (!element || !element.clientHeight) return this.snapshot;
    if (props.itemKeys) {
      const index = this.pointerKey === null ? -1 : props.itemKeys.indexOf(this.pointerKey);
      return {
        keys: props.itemKeys,
        index: index < 0 ? Math.floor(element.scrollTop / props.rowHeight) : index,
        scrollTop: element.scrollTop,
      };
    }
    const top = element.getBoundingClientRect().top + element.clientTop;
    const rows = [...element.querySelectorAll('[data-scroll-key]')].map((row) => ({
      key: row.dataset.scrollKey,
      offset: row.getBoundingClientRect().top - top,
      bottom: row.getBoundingClientRect().bottom - top,
    }));
    const index = Math.max(
      0,
      rows.findIndex((row) => row.bottom > 0),
    );
    return {
      rows: [...rows.slice(index), ...rows.slice(0, index).reverse()],
      scrollTop: element.scrollTop,
    };
  }

  scrollTo(top) {
    const element = this.element;
    const target = Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight));
    if (Math.abs(element.scrollTop - target) < 0.5) return;
    this.expectedScrollTop = target;
    element.scrollTop = target;
  }

  restore(snapshot) {
    if (!this.element?.clientHeight) return;
    if (snapshot?.reset || this.props.following) {
      this.scrollTo(0);
      return;
    }
    if (!snapshot) return;
    if (snapshot.keys && this.props.itemKeys) {
      const positions = new Map(this.props.itemKeys.map((key, index) => [key, index]));
      // If eviction removes the anchor, use its nearest surviving neighbor.
      for (let distance = 0; distance < snapshot.keys.length; distance++) {
        for (const index of distance
          ? [snapshot.index + distance, snapshot.index - distance]
          : [snapshot.index]) {
          const position = positions.get(snapshot.keys[index]);
          if (position !== undefined) {
            this.scrollTo(snapshot.scrollTop + (position - index) * this.props.rowHeight);
            return;
          }
        }
      }
    } else if (snapshot.rows) {
      const rows = new Map(
        [...this.element.querySelectorAll('[data-scroll-key]')].map((row) => [
          row.dataset.scrollKey,
          row,
        ]),
      );
      const top = this.element.getBoundingClientRect().top + this.element.clientTop;
      for (const anchor of snapshot.rows) {
        const row = rows.get(anchor.key);
        if (row) {
          this.scrollTo(
            this.element.scrollTop + row.getBoundingClientRect().top - top - anchor.offset,
          );
          return;
        }
      }
    }
    this.scrollTo(snapshot.scrollTop);
  }

  observeRows() {
    this.observer?.disconnect();
    if (!this.element) return;
    this.observer?.observe(this.element);
    // Payload inspectors can change row height without updating this component's props.
    if (!this.props.itemKeys)
      this.element
        .querySelectorAll('[data-scroll-key]')
        .forEach((row) => this.observer?.observe(row));
  }

  componentDidMount() {
    this.snapshot = this.capture();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        this.restore(this.snapshot);
        this.snapshot = this.props.following ? null : this.capture();
      });
      this.observeRows();
    }
  }

  getSnapshotBeforeUpdate(previous) {
    if (previous.viewKey !== this.props.viewKey) return { reset: true };
    if (this.props.following) return null;
    return this.capture(previous);
  }

  componentDidUpdate(_previous, _state, snapshot) {
    this.restore(snapshot);
    if (snapshot?.reset) {
      this.pointerKey = null;
      if (!this.props.following) this.props.onFollowingChange?.(true);
    }
    this.snapshot = this.props.following
      ? null
      : this.element?.clientHeight
        ? this.capture()
        : snapshot;
    // The virtualizer can render another window after scrolling; it owns row geometry.
    if (!this.props.itemKeys) this.observeRows();
  }

  componentWillUnmount() {
    this.observer?.disconnect();
  }

  handleScroll = () => {
    const top = this.element.scrollTop;
    const programmatic =
      this.expectedScrollTop !== null && Math.abs(top - this.expectedScrollTop) < 1;
    this.expectedScrollTop = null;
    if (!programmatic) this.props.onFollowingChange?.(top <= 2);
    this.snapshot = this.capture();
  };

  render() {
    return (
      <div
        className={this.props.className}
        ref={this.setElement}
        onScroll={this.handleScroll}
        style={{ overflowAnchor: 'none' }}
        onPointerMove={
          this.props.itemKeys
            ? (event) => {
                this.pointerKey =
                  event.target.closest('[data-scroll-key]')?.dataset.scrollKey ?? null;
              }
            : undefined
        }
        onPointerLeave={() => {
          this.pointerKey = null;
        }}
      >
        {this.props.children}
      </div>
    );
  }
}
