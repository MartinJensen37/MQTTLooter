import React from 'react';

interface Props {
  templateToDelete: string;
  templateService: any;
  cancelTemplateDelete: () => void;
  confirmTemplateDelete: () => void;
}

function TemplateDeleteDialog({
  templateToDelete,
  templateService,
  cancelTemplateDelete,
  confirmTemplateDelete,
}: Props) {
  return (
    <div className="modal-overlay template-delete-dialog">
      <div className="confirmation-modal">
        <div className="modal-header">
          <h3>Delete message schema</h3>
        </div>
        <div className="modal-content">
          <p>
            Delete <strong>"{templateService.getTemplate(templateToDelete)?.name}"</strong> from
            your message schemas?
          </p>
          <p className="warning-text">This action cannot be undone.</p>
        </div>
        <div className="modal-actions">
          <button onClick={cancelTemplateDelete} className="btn btn-sm btn-secondary">
            Cancel
          </button>
          <button onClick={confirmTemplateDelete} className="btn btn-sm btn-danger">
            <i className="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(TemplateDeleteDialog);
