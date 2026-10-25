import type { ReactNode } from 'react';

/**
 * A checkbox styled like the connection editor's options. With children it reveals them while
 * checked, so optional settings and hidden sections share one look. `compact` drops the box for
 * use inside message cards; `keepMounted` keeps hidden children in the document.
 */
export default function CheckToggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  compact,
  keepMounted,
  className,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
  keepMounted?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={['check-toggle', compact && 'check-toggle-compact', className]
        .filter(Boolean)
        .join(' ')}
    >
      <label className="check-toggle-label">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="check-toggle-box" aria-hidden="true" />
        <span className="check-toggle-text">{label}</span>
      </label>
      {hint && <p className="check-toggle-hint">{hint}</p>}
      {children !== undefined && (checked || keepMounted) && (
        <div className="check-toggle-body" hidden={!checked}>
          {children}
        </div>
      )}
    </div>
  );
}
