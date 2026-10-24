import { useMemo, useState } from 'react';
import { formatPayloadBytes } from '../../../../../shared/payload';
import { prettyPayload } from '../../../utils/payloadPresentation';
import type { SimulationPayloadMode } from './types';

export default function SimulationPayloadPreview({
  payload,
  mode = 'json',
}: {
  payload: string;
  mode?: SimulationPayloadMode;
}) {
  const [view, setView] = useState<'text' | 'hex' | 'json'>(mode === 'raw' ? 'text' : 'json');
  const [feedback, setFeedback] = useState('');
  const size = useMemo(() => new TextEncoder().encode(payload).length, [payload]);
  const pretty = useMemo(
    () => (view === 'json' ? prettyPayload(payload, 'utf8') : undefined),
    [payload, view],
  );
  const text =
    pretty?.text ?? formatPayloadBytes(payload, 'utf8', view === 'hex' ? 'hex' : 'text', 4096);
  return (
    <div className="simulation-payload-preview">
      <div className="simulation-payload-controls">
        <label>
          Preview view
          <select
            className="custom-select-button form-select"
            value={view}
            onChange={(event) => setView(event.target.value as typeof view)}
          >
            <option value="text">Exact text</option>
            <option value="hex">Hex bytes</option>
            <option value="json">Pretty JSON</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(payload);
              setFeedback('Payload copied.');
            } catch {
              setFeedback('Could not copy the payload.');
            }
          }}
        >
          Copy payload
        </button>
      </div>
      <p>
        {size.toLocaleString()} UTF-8 bytes{size === 0 ? ' (empty payload)' : ''}
      </p>
      {pretty?.notice && <p>{pretty.notice}</p>}
      <pre tabIndex={0}>{text}</pre>
      <span role="status">{feedback}</span>
    </div>
  );
}
