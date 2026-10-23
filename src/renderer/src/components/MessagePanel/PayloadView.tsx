import { memo, useMemo, useState } from 'react';
import { formatPayloadBytes, type PayloadEncoding } from '../../../../shared/payload';
import { prettyPayload } from '../../utils/payloadPresentation';

function PayloadView({
  value,
  encoding = 'utf8',
  previewBytes = 100,
}: {
  value: string;
  encoding?: PayloadEncoding;
  previewBytes?: number;
}) {
  const [view, setView] = useState<'text' | 'hex' | 'json'>(encoding === 'base64' ? 'hex' : 'text');
  const [expanded, setExpanded] = useState(false);
  const formatted = useMemo(
    () => (view === 'json' ? prettyPayload(value, encoding) : null),
    [value, encoding, view],
  );
  return (
    <div>
      <label>
        View{' '}
        <select
          className="custom-select-button form-select form-select-compact"
          aria-label="Payload view"
          value={view}
          onChange={(e) => setView(e.target.value as 'text' | 'hex' | 'json')}
        >
          <option value="text">Text</option>
          <option value="hex">Hex</option>
          <option value="json" disabled={encoding !== 'utf8'}>
            Pretty JSON
          </option>
        </select>
      </label>
      {encoding === 'base64' && view === 'text' && (
        <span> Text preview may replace invalid UTF-8; export preserves bytes.</span>
      )}
      {formatted?.notice && <p className="payload-format-notice">{formatted.notice}</p>}
      <div className="payload-preview">
        {view === 'json' && formatted?.text
          ? formatted.text.slice(0, previewBytes)
          : formatPayloadBytes(value, encoding, view === 'hex' ? 'hex' : 'text', previewBytes)}
      </div>
      <details className="payload-full" onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>Inspect payload</summary>
        {expanded && (
          <pre
            className="payload-code payload-resizable"
            tabIndex={0}
            aria-label="Payload inspector"
          >
            {view === 'json' && formatted?.text
              ? formatted.text
              : formatPayloadBytes(value, encoding, view === 'hex' ? 'hex' : 'text')}
          </pre>
        )}
      </details>
    </div>
  );
}

export default memo(PayloadView);
