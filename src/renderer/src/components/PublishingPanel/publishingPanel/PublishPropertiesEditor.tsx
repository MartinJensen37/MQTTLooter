import type { PropertyDraft } from './propertyDraft';
import './PublishPropertiesEditor.css';

export default function PublishPropertiesEditor({
  draft,
  onChange,
  protocolVersion,
  disabled,
  error,
}: {
  draft: PropertyDraft;
  onChange: (draft: PropertyDraft) => void;
  protocolVersion: number;
  disabled: boolean;
  error?: string;
}) {
  const change = (patch: Partial<PropertyDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="publish-properties">
      <details>
        <summary>MQTT 5 publish properties{draft.enabled ? ' · Enabled' : ''}</summary>
        <label className="publish-properties-enable">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={disabled || (protocolVersion !== 5 && !draft.enabled)}
            onChange={(event) => change({ enabled: event.target.checked })}
          />
          Include MQTT 5 properties
        </label>
        {protocolVersion !== 5 && (
          <p>
            These properties require MQTT 5. Disable them to publish on this connection; the saved
            fields are kept.
          </p>
        )}
        <fieldset disabled={disabled || !draft.enabled || protocolVersion !== 5}>
          <legend>Message properties</legend>
          <div className="publish-properties-grid">
            <label>
              Response topic
              <input
                className="form-input"
                aria-label="Publish response topic"
                value={draft.responseTopic}
                maxLength={65535}
                onChange={(event) => change({ responseTopic: event.target.value })}
              />
            </label>
            <label>
              Content type
              <input
                className="form-input"
                aria-label="Publish content type"
                value={draft.contentType}
                maxLength={65535}
                placeholder="application/json"
                onChange={(event) => change({ contentType: event.target.value })}
              />
            </label>
            <label>
              Expiry (seconds)
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                aria-label="Publish expiry"
                value={draft.expiry}
                maxLength={10}
                placeholder="Blank: no expiry"
                onChange={(event) => change({ expiry: event.target.value })}
              />
            </label>
            <label>
              Payload format
              <select
                className="form-select custom-select-button"
                aria-label="Publish payload format"
                value={draft.format}
                onChange={(event) =>
                  change({ format: event.target.value as PropertyDraft['format'] })
                }
              >
                <option value="">Not specified</option>
                <option value="bytes">Unspecified bytes (0)</option>
                <option value="utf8">UTF-8 (1)</option>
              </select>
            </label>
          </div>
          <label className="publish-properties-enable">
            <input
              type="checkbox"
              checked={draft.correlationEnabled}
              onChange={(event) => change({ correlationEnabled: event.target.checked })}
            />
            Include correlation data
          </label>
          {draft.correlationEnabled && (
            <div className="publish-properties-grid">
              <label>
                Correlation encoding
                <select
                  className="form-select custom-select-button"
                  aria-label="Publish correlation encoding"
                  value={draft.correlationEncoding}
                  onChange={(event) =>
                    change({ correlationEncoding: event.target.value as 'hex' | 'base64' })
                  }
                >
                  <option value="hex">Hex bytes</option>
                  <option value="base64">Base64 bytes</option>
                </select>
              </label>
              <label>
                Correlation data
                <input
                  className="form-input"
                  aria-label="Publish correlation data"
                  value={draft.correlation}
                  maxLength={196605}
                  placeholder={draft.correlationEncoding === 'hex' ? '00 ff 80' : 'AP+A'}
                  onChange={(event) => change({ correlation: event.target.value })}
                />
              </label>
            </div>
          )}
          <div className="publish-user-properties">
            <p>User properties ({draft.users.length})</p>
            {draft.users.length > 64 && (
              <p>
                Only the first 64 saved pairs are displayed. Clear user properties to reset this
                oversized draft.
              </p>
            )}
            {draft.users.slice(0, 64).map((row, index) => (
              <div className="publish-user-property" key={index}>
                <input
                  className="form-input"
                  aria-label={`User property ${index + 1} name`}
                  placeholder="Name"
                  value={row.name}
                  maxLength={65535}
                  onChange={(event) =>
                    change({
                      users: draft.users.map((item, i) =>
                        i === index ? { ...item, name: event.target.value } : item,
                      ),
                    })
                  }
                />
                <input
                  className="form-input"
                  aria-label={`User property ${index + 1} value`}
                  placeholder="Value"
                  value={row.value}
                  maxLength={65535}
                  onChange={(event) =>
                    change({
                      users: draft.users.map((item, i) =>
                        i === index ? { ...item, value: event.target.value } : item,
                      ),
                    })
                  }
                />
                <button
                  className="btn btn-sm btn-secondary"
                  type="button"
                  aria-label={`Remove user property ${index + 1}`}
                  onClick={() => change({ users: draft.users.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="btn btn-sm btn-secondary"
              type="button"
              disabled={draft.users.length >= 64}
              onClick={() => change({ users: [...draft.users, { name: '', value: '' }] })}
            >
              Add user property
            </button>
            {draft.users.length > 1 && (
              <button
                className="btn btn-sm btn-secondary"
                type="button"
                onClick={() => change({ users: [] })}
              >
                Clear user properties
              </button>
            )}
          </div>
        </fieldset>
      </details>
      {error && (
        <p className="publish-properties-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
