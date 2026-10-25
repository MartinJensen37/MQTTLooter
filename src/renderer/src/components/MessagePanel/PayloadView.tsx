import { memo, useEffect, useMemo, useState } from 'react';
import { formatPayloadBytes, type PayloadEncoding } from '../../../../shared/payload';
import { matchDecoder } from '../../../../shared/decoders';
import { prettyPayload } from '../../utils/payloadPresentation';
import { decoderRegistry, useDecoders } from '../../services/DecoderRegistry';
import CheckToggle from '../Controls/CheckToggle';

/** Chosen once per topic above the cards. Auto picks per message. */
export type PayloadViewMode = 'auto' | 'text' | 'hex' | 'decoded';
type Shown = 'text' | 'hex' | 'json' | 'decoded';
const PREVIEW_LINES = 8;

/** The first lines of a payload, within a character budget. */
function clip(text: string, characters: number): string {
  let end = -1;
  for (let line = 0; line < PREVIEW_LINES; line++) {
    end = text.indexOf('\n', end + 1);
    if (end === -1) break;
  }
  const limit = Math.min(end === -1 ? text.length : end, characters);
  return limit < text.length ? `${text.slice(0, limit)}…` : text;
}

function PayloadView({
  value,
  encoding = 'utf8',
  previewBytes = 100,
  topic,
  view = 'auto',
}: {
  value: string;
  encoding?: PayloadEncoding;
  /** Characters per preview line at the current width. */
  previewBytes?: number;
  /** Enables decoding when a saved decoder matches this topic. */
  topic?: string;
  view?: PayloadViewMode;
}) {
  const { decoders } = useDecoders();
  const decoder = topic === undefined ? undefined : matchDecoder(decoders, topic);
  // Auto: decoded when a decoder matches, hex for binary, indented JSON objects/arrays, else text.
  // The JSON check only parses payloads that start like an object or array.
  const formatted = useMemo(
    () =>
      view === 'auto' && !decoder && encoding === 'utf8' && /^\s*[[{]/.test(value)
        ? prettyPayload(value, encoding)
        : null,
    [view, decoder, encoding, value],
  );
  const shown: Shown =
    (view === 'decoded' || view === 'auto') && decoder
      ? 'decoded'
      : view === 'hex' || (view === 'auto' && encoding === 'base64')
        ? 'hex'
        : formatted?.text
          ? 'json'
          : 'text';
  const [expanded, setExpanded] = useState(false);
  const [decoded, setDecoded] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    if (shown !== 'decoded' || !decoder) return;
    let cancelled = false;
    setDecoded({});
    decoderRegistry
      .decode(decoder, value, encoding)
      .then((text) => !cancelled && setDecoded({ text }))
      .catch((error: Error) => !cancelled && setDecoded({ error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [shown, decoder, value, encoding]);
  const text =
    shown === 'decoded'
      ? (decoded.text ?? (decoded.error ? '' : 'Decoding…'))
      : shown === 'json'
        ? formatted!.text!
        : null;
  const full = () =>
    text !== null ? text : formatPayloadBytes(value, encoding, shown === 'hex' ? 'hex' : 'text');
  return (
    <div>
      {encoding === 'base64' && shown === 'text' && (
        <p className="payload-format-notice">Not valid UTF-8; invalid bytes are replaced.</p>
      )}
      {shown === 'decoded' && decoded.error && (
        <p className="payload-format-notice" role="status">
          {decoded.error}
        </p>
      )}
      <div className="payload-preview">
        {text !== null
          ? clip(text, previewBytes * PREVIEW_LINES)
          : clip(
              formatPayloadBytes(
                value,
                encoding,
                shown === 'hex' ? 'hex' : 'text',
                previewBytes * PREVIEW_LINES,
              ),
              previewBytes * PREVIEW_LINES,
            )}
      </div>
      <CheckToggle
        compact
        className="payload-full"
        label="Inspect payload"
        checked={expanded}
        onChange={setExpanded}
      >
        <pre className="payload-code payload-resizable" tabIndex={0} aria-label="Payload inspector">
          {full()}
        </pre>
      </CheckToggle>
    </div>
  );
}

export default memo(PayloadView);
