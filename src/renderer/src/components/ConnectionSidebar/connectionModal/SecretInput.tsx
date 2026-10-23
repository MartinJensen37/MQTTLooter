import { useState, type InputHTMLAttributes } from 'react';

export default function SecretInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mqtt-secret-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((previous) => !previous)}
      >
        <i className={`fas ${visible ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
