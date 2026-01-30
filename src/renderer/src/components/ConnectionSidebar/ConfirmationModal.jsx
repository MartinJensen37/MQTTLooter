import React from 'react';
import './ConfirmationModal.css';

function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Delete',
  confirmIcon = 'fa-trash',
  confirmVariant = 'danger'
}) {
  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // Handle escape key
  React.useEffect(() => {
    if (isOpen) {
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          onCancel();
        }
      };

      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onCancel]);

  return (
    <div className="confirmation-overlay" onClick={handleOverlayClick}>
      <div className="confirmation-modal">
        <div className="confirmation-header">
          <h3>
            <i className="fas fa-exclamation-triangle warning-icon"></i>
            {title}
          </h3>
        </div>
        <div className="confirmation-content">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>
        <div className="confirmation-footer">
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>
            <i className="fas fa-times"></i>
            Cancel
          </button>
          <button className={`btn btn-sm btn-${confirmVariant}`} onClick={onConfirm}>
            <i className={`fas ${confirmIcon}`}></i>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}


export default ConfirmationModal;