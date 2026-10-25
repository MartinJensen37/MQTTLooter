import { useState } from 'react';
import { validTopicFilter } from '../../../../shared/history-search';
import { DECODER_LIMITS } from '../../../../shared/decoders';
import { decoderRegistry, useDecoders } from '../../services/DecoderRegistry';
import './DecoderSettings.css';

/** Protobuf decoders: a `.proto` file and message type applied to an MQTT topic filter. */
export default function DecoderSettings({ onClose }: { onClose: () => void }) {
  const { decoders, errors } = useDecoders();
  const [name, setName] = useState('');
  const [topicFilter, setTopicFilter] = useState('#');
  const [proto, setProto] = useState<{ file: string; text: string } | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [messageType, setMessageType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Remounting clears the native file input, so the same file can be chosen again.
  const [fileInput, setFileInput] = useState(0);

  const save = async (next: typeof decoders) => {
    setBusy(true);
    setError('');
    try {
      await decoderRegistry.save(next);
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const readProto = async (file: File | undefined) => {
    setTypes([]);
    setMessageType('');
    setProto(null);
    setError('');
    if (!file) return;
    if (file.size > DECODER_LIMITS.maxProtoChars) {
      setError('.proto files must be at most 1 MiB.');
      return;
    }
    const text = await file.text();
    const result = await window.electronAPI.decoders.types(text);
    if (!result.success || !result.data) {
      setError(`${file.name}: ${result.error}`);
      return;
    }
    if (!result.data.length) {
      setError(`${file.name} declares no message types.`);
      return;
    }
    setProto({ file: file.name, text });
    setTypes(result.data);
    setMessageType(result.data[0]);
    if (!name) setName(result.data[0].split('.').pop()!);
  };

  const filterValid = validTopicFilter(topicFilter);
  const add = async () => {
    if (!proto || !messageType || !name.trim() || !filterValid) return;
    const added = await save([
      ...decoders,
      { id: crypto.randomUUID(), name: name.trim(), topicFilter, messageType, proto: proto.text },
    ]);
    if (added) {
      setFileInput((value) => value + 1);
      setName('');
      setProto(null);
      setTypes([]);
      setMessageType('');
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-container decoder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decoder-dialog-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="modal-header">
          <h2 id="decoder-dialog-title">Payload decoders</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close decoders">
            ×
          </button>
        </div>
        <div className="decoder-dialog-body">
          {decoders.length ? (
            <ol className="decoder-list" aria-label="Saved decoders">
              {decoders.map((decoder) => (
                <li key={decoder.id}>
                  <div>
                    <strong>{decoder.name}</strong> <code>{decoder.topicFilter}</code>{' '}
                    <span className="decoder-type">{decoder.messageType}</span>
                    {errors[decoder.id] && <p role="alert">{errors[decoder.id]}</p>}
                  </div>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    aria-label={`Remove decoder ${decoder.name}`}
                    onClick={() => void save(decoders.filter((item) => item.id !== decoder.id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>No decoders yet. The first decoder whose filter matches a topic is used.</p>
          )}
          {errors.file && <p role="alert">{errors.file}</p>}
          <fieldset className="decoder-form">
            <legend>Add a protobuf decoder</legend>
            <label>
              .proto file
              <input
                key={fileInput}
                type="file"
                accept=".proto,text/plain"
                aria-label="Protobuf schema file"
                onChange={(event) => void readProto(event.target.files?.[0])}
              />
            </label>
            <label>
              Message type
              <select
                className="form-select custom-select-button"
                aria-label="Message type"
                value={messageType}
                disabled={!types.length}
                onChange={(event) => setMessageType(event.target.value)}
              >
                {types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Topic filter
              <input
                className="form-input"
                aria-label="Decoder topic filter"
                value={topicFilter}
                placeholder="sensors/+/data"
                onChange={(event) => setTopicFilter(event.target.value)}
              />
            </label>
            <label>
              Name
              <input
                className="form-input"
                aria-label="Decoder name"
                value={name}
                maxLength={128}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {!filterValid && (
              <p role="alert">Enter an MQTT topic filter, for example sensors/+/data.</p>
            )}
            {error && <p role="alert">{error}</p>}
          </fieldset>
        </div>
        <div className="modal-footer">
          <button className="btn btn-md btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn-md btn-primary"
            disabled={busy || !proto || !messageType || !name.trim() || !filterValid}
            onClick={() => void add()}
          >
            Add decoder
          </button>
        </div>
      </div>
    </div>
  );
}
