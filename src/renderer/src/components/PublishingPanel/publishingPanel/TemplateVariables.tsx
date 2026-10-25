import type { TemplateVariable } from '../../../../../shared/template-expansion';
import './TemplateVariables.css';

interface Props {
  definitions: Record<string, TemplateVariable>;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onApply: () => void;
  error: string;
  disabled: boolean;
}

export default function TemplateVariables({
  definitions,
  values,
  onChange,
  onApply,
  error,
  disabled,
}: Props) {
  return (
    <div className="publish-template-variables">
      <div className="publish-template-fields">
        {Object.keys(values).map((name) => {
          const type = definitions[name]?.type;
          return (
            <label key={name}>
              {definitions[name]?.description ?? name}
              {type === 'boolean' ? (
                <select
                  className="custom-select-button form-select"
                  aria-label={`Schema variable ${name}`}
                  value={values[name]}
                  disabled={disabled}
                  onChange={(event) => onChange(name, event.target.value)}
                >
                  <option value="">Select value</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : (
                <input
                  className="form-input"
                  aria-label={`Schema variable ${name}`}
                  value={values[name]}
                  disabled={disabled}
                  onChange={(event) => onChange(name, event.target.value)}
                  inputMode={type === 'number' || type === 'integer' ? 'decimal' : undefined}
                />
              )}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={onApply}
      >
        Fill payload
      </button>
      {error && (
        <p className="publish-template-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
