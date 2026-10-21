import { memo, useState } from 'react';
import { formatPayloadBytes, type PayloadEncoding } from '../../../../shared/payload';

function PayloadView({ value, encoding = 'utf8' }: { value: string; encoding?: PayloadEncoding }) {
  const [view, setView] = useState<'text' | 'hex'>(encoding === 'base64' ? 'hex' : 'text');
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <label>
        View{' '}
        <select
          aria-label="Payload view"
          value={view}
          onChange={(e) => setView(e.target.value as 'text' | 'hex')}
        >
          <option value="text">Text</option>
          <option value="hex">Hex</option>
        </select>
      </label>
      {encoding === 'base64' && view === 'text' && (
        <span> Text preview may replace invalid UTF-8; export preserves bytes.</span>
      )}
      <div className="payload-preview">{formatPayloadBytes(value, encoding, view, 100)}</div>
      <details className="payload-full" onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>Inspect payload</summary>
        {expanded && (
          <pre className="payload-code">{formatPayloadBytes(value, encoding, view)}</pre>
        )}
      </details>
    </div>
  );
}

export default memo(PayloadView);
