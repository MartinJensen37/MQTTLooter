import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small "i" that explains a field on hover or keyboard focus. The text is drawn on the page
 * body, so scrolling dialogs cannot clip it. Clicking it does nothing, even inside a label.
 */
export default function InfoTip({ text }: { text: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const id = useId();
  const show = () => setBox(anchor.current?.getBoundingClientRect() ?? null);
  const hide = () => setBox(null);
  // Above the icon, or below it near the top of the window; kept inside the window's width.
  const below = box !== null && box.top < 90;
  const center = box ? box.left + box.width / 2 : 0;
  return (
    <>
      <span
        ref={anchor}
        className="info-tip"
        tabIndex={0}
        role="img"
        aria-label={typeof text === 'string' ? text : 'More information'}
        aria-describedby={box && typeof text !== 'string' ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => event.key === 'Escape' && hide()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <i className="fas fa-info-circle" aria-hidden="true" />
      </span>
      {box &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="info-tip-bubble"
            style={{
              left: Math.min(Math.max(center, 140), window.innerWidth - 140),
              top: below ? box.bottom + 8 : box.top - 8,
              transform: `translate(-50%, ${below ? '0' : '-100%'})`,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
