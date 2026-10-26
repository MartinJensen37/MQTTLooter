import { Component, type MutableRefObject, type ReactNode } from 'react';

interface Props {
  className?: string;
  children?: ReactNode;
  /** Changing it scrolls back to the top, for a different list. */
  viewKey?: string;
  /** Pinned to the top as rows are added. */
  following?: boolean;
  onFollowingChange?: (following: boolean) => void;
  viewportRef?: MutableRefObject<HTMLDivElement | null>;
  /** For a virtualized list of fixed-height rows: the keys of every row, in order. */
  itemKeys?: string[];
  rowHeight?: number;
}

type Snapshot =
  | { reset: true }
  | { keys: string[]; index: number; scrollTop: number }
  | { rows: { key: string; offset: number; bottom: number }[]; scrollTop: number }
  | null;

/** Capture before React mutates rows; restore the same row and pixel offset after commit. */
export default class StableScrollViewport extends Component<Props> {
  element: HTMLDivElement | null = null;
  snapshot: Snapshot = null;
  expectedScrollTop: number | null = null;
  pointerKey: string | null = null;
  observer: ResizeObserver | null = null;

  setElement = (element: HTMLDivElement | null) => {
    this.element = element;
    if (this.props.viewportRef) this.props.viewportRef.current = element;
  };

  capture(props: Props = this.props): Snapshot {
    const element = this.element;
    if (!element || !element.clientHeight) return this.snapshot;
    if (props.itemKeys) {
      const rowHeight = props.rowHeight ?? 1;
      const index = this.pointerKey === null ? -1 : props.itemKeys.indexOf(this.pointerKey);
      return {
        keys: props.itemKeys,
        index: index < 0 ? Math.floor(element.scrollTop / rowHeight) : index,
        scrollTop: element.scrollTop,
      };
    }
    const top = element.getBoundingClientRect().top + element.clientTop;
    const rows = [...element.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((row) => ({
      key: row.dataset.scrollKey!,
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

  scrollTo(top: number) {
    const element = this.element!;
    const target = Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight));
    if (Math.abs(element.scrollTop - target) < 0.5) return;
    this.expectedScrollTop = target;
    element.scrollTop = target;
  }

  restore(snapshot: Snapshot) {
    if (!this.element?.clientHeight) return;
    if ((snapshot && 'reset' in snapshot) || this.props.following) {
      this.scrollTo(0);
      return;
    }
    if (!snapshot) return;
    if ('keys' in snapshot && this.props.itemKeys) {
      const rowHeight = this.props.rowHeight ?? 1;
      const positions = new Map(this.props.itemKeys.map((key, index) => [key, index]));
      // If eviction removes the anchor, use its nearest surviving neighbor.
      for (let distance = 0; distance < snapshot.keys.length; distance++) {
        for (const index of distance
          ? [snapshot.index + distance, snapshot.index - distance]
          : [snapshot.index]) {
          const position = positions.get(snapshot.keys[index]);
          if (position !== undefined) {
            this.scrollTo(snapshot.scrollTop + (position - index) * rowHeight);
            return;
          }
        }
      }
    } else if ('rows' in snapshot) {
      const rows = new Map(
        [...this.element.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((row) => [
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
    if ('scrollTop' in snapshot) this.scrollTo(snapshot.scrollTop);
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

  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (previous.viewKey !== this.props.viewKey) return { reset: true };
    if (this.props.following) return null;
    return this.capture(previous);
  }

  componentDidUpdate(_previous: Props, _state: unknown, snapshot: Snapshot) {
    this.restore(snapshot);
    if (snapshot && 'reset' in snapshot) {
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
    const top = this.element!.scrollTop;
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
                  (event.target as Element).closest<HTMLElement>('[data-scroll-key]')?.dataset
                    .scrollKey ?? null;
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
