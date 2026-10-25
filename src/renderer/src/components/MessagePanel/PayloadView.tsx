import { memo, useEffect, useMemo, useState } from 'react';
import { formatPayloadBytes, type PayloadEncoding } from '../../../../shared/payload';
import { matchDecoder } from '../../../../shared/decoders';
import { prettyPayload } from '../../utils/payloadPresentation';
import { decoderRegistry, useDecoders } from '../../services/DecoderRegistry';

type View = 'text' | 'hex' | 'json' | 'decoded';

function PayloadView({
  value,
  encoding = 'utf8',
  previewBytes = 100,
  topic,
}: {
  value: string;
  encoding?: PayloadEncoding;
  previewBytes?: number;
  /** Enables the Decoded view when a saved decoder matches this topic. */
  topic?: string;
}) {
  const { decoders } = useDecoders();
  const decoder = topic === undefined ? undefined : matchDecoder(decoders, topic);
  // Decoded is the default once a matching decoder exists, unless a view was chosen.
  const [chosen, setChosen] = useState<View | null>(null);
  const view: View =
    chosen === 'decoded' && !decoder
      ? 'text'
      : (chosen ?? (decoder ? 'decoded' : encoding === 'base64' ? 'hex' : 'text'));
  const [expanded, setExpanded] = useState(false);
  const [decoded, setDecoded] = useState<{ text?: string; error?: string }>({});
  const formatted = useMemo(
    () => (view === 'json' ? prettyPayload(value, encoding) : null),
    [value, encoding, view],
  );
  useEffect(() => {
    if (view !== 'decoded' || !decoder) return;
    let cancelled = false;
    setDecoded({});
    decoderRegistry
      .decode(decoder, value, encoding)
      .then((text) => !cancelled && setDecoded({ text }))
      .catch((error: Error) => !cancelled && setDecoded({ error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [view, decoder, value, encoding]);
  const text =
    view === 'decoded'
      ? (decoded.text ?? (decoded.error ? '' : 'Decoding…'))
      : view === 'json' && formatted?.text
        ? formatted.text
        : null;
  return (
    <div>
      <label>
        View{' '}
        <select
          className="custom-select-button form-select form-select-compact"
          aria-label="Payload view"
          value={view}
          onChange={(e) => setChosen(e.target.value as View)}
        >
          <option value="text">Text</option>
          <option value="hex">Hex</option>
          <option value="json" disabled={encoding !== 'utf8'}>
            Pretty JSON
          </option>
          {decoder && <option value="decoded">Decoded ({decoder.name})</option>}
        </select>
      </label>
      {encoding === 'base64' && view === 'text' && (
        <span> Text preview may replace invalid UTF-8; export preserves bytes.</span>
      )}
      {formatted?.notice && <p className="payload-format-notice">{formatted.notice}</p>}
      {view === 'decoded' && decoded.error && (
        <p className="payload-format-notice" role="status">
          {decoded.error}
        </p>
      )}
      <div className="payload-preview">
        {text !== null
          ? text.slice(0, previewBytes)
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
            {text !== null
              ? text
              : formatPayloadBytes(value, encoding, view === 'hex' ? 'hex' : 'text')}
          </pre>
        )}
      </details>
    </div>
  );
}

export default memo(PayloadView);
