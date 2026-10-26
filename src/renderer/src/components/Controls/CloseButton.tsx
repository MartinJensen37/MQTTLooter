/** The close button every dialog uses: a small gray pill with an ×, red on hover. */
export default function CloseButton({
  onClick,
  label = 'Close',
}: {
  onClick: () => void;
  /** Accessible name, e.g. "Close settings". */
  label?: string;
}) {
  return (
    <button type="button" className="close-btn" onClick={onClick} aria-label={label} title="Close">
      <i className="fas fa-times" aria-hidden="true"></i>
    </button>
  );
}
