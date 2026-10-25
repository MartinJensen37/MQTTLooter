import React from 'react';
import type { SchemaValidationResult } from './types';

interface Props {
  payload: string;
  setPayload: React.Dispatch<React.SetStateAction<string>>;
  isPublishing: boolean;
  isValidJson: (str: string) => boolean;
  formatJsonPayload: () => void;
  copyToClipboard: (text: string, feedbackMsg: string) => void;
  schemaValidation: SchemaValidationResult | null;
}

function PayloadEditor({
  payload,
  setPayload,
  isPublishing,
  isValidJson,
  formatJsonPayload,
  copyToClipboard,
  schemaValidation,
}: Props) {
  return (
    <div className="form-group">
      <div className="payload-header">
        <label htmlFor="payload">Payload:</label>
        <div className="payload-tools">
          {payload && (
            <button
              type="button"
              onClick={() => copyToClipboard(payload, 'Payload copied!')}
              className="copy-payload-btn"
              title="Copy payload"
            >
              <i className="fas fa-copy"></i>
            </button>
          )}
        </div>
      </div>
      <textarea
        id="payload"
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        placeholder="Text or JSON"
        className="payload-input"
        rows={6}
        disabled={isPublishing}
      />
      <div className="payload-info">
        <span className="char-count">{payload.length} characters</span>
        <div className="validation-indicators">
          {payload && isValidJson(payload) && (
            <span className="json-indicator">
              <i className="fas fa-check-circle"></i> Valid JSON
              <button
                type="button"
                className="json-format-btn"
                onClick={formatJsonPayload}
                disabled={isPublishing}
                title="Indent the JSON payload"
              >
                Format
              </button>
            </span>
          )}
          {schemaValidation && (
            <span className={`schema-validation ${schemaValidation.valid ? 'valid' : 'invalid'}`}>
              <i
                className={`fas ${schemaValidation.valid ? 'fa-shield-alt' : 'fa-exclamation-triangle'}`}
              ></i>
              {schemaValidation.valid
                ? 'Matches schema'
                : `Does not match schema (${schemaValidation.errors.length})`}
            </span>
          )}
        </div>
      </div>

      {/* Schema validation errors */}
      {schemaValidation && !schemaValidation.valid && (
        <div className="schema-errors">
          <div className="schema-errors-header">
            <i className="fas fa-exclamation-triangle"></i>
            Differences from the schema:
          </div>
          <ul className="schema-error-list">
            {schemaValidation.errors.map((error, index) => (
              <li key={index} className="schema-error-item">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default React.memo(PayloadEditor);
