import React from 'react';
import './ConfirmationModal.css';

function ConfirmationModal({ isOpen, title, message, onConfirm, onCancel }) {
  // Close on Escape while open. Hook stays above the early return to keep call order stable.
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  // Click on the backdrop (but not the modal itself) cancels.
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

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
          <p>{message}</p>
        </div>
        <div className="confirmation-footer">
          <button className="cancel-btn" onClick={onCancel}>
            <i className="fas fa-times"></i>
            Cancel
          </button>
          <button className="confirm-btn danger" onClick={onConfirm}>
            <i className="fas fa-trash"></i>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;