import React from 'react';
import type { MessageTemplate, SchemaValidationResult } from './types';
import CheckToggle from '../../Controls/CheckToggle';

interface Props {
  showTemplates: boolean;
  setShowTemplates: React.Dispatch<React.SetStateAction<boolean>>;
  handleTemplateImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleTemplateExport: () => void;
  messageTemplates: MessageTemplate[];
  showTemplateDropdown: boolean;
  setShowTemplateDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  isPublishing: boolean;
  getSelectedTemplateName: () => string;
  selectedTemplate: string | null;
  setSelectedTemplate: React.Dispatch<React.SetStateAction<string | null>>;
  setSchemaValidation: React.Dispatch<React.SetStateAction<SchemaValidationResult | null>>;
  handleTemplateSelect: (templateId: string) => void;
  handleTemplateDelete: (templateId: string) => void;
}

function TemplatesSection({
  showTemplates,
  setShowTemplates,
  handleTemplateImport,
  handleTemplateExport,
  messageTemplates,
  showTemplateDropdown,
  setShowTemplateDropdown,
  isPublishing,
  getSelectedTemplateName,
  selectedTemplate,
  setSelectedTemplate,
  setSchemaValidation,
  handleTemplateSelect,
  handleTemplateDelete,
}: Props) {
  return (
    <div className="form-group">
      <CheckToggle
        className="message-schemas"
        label="Message schemas"
        hint={showTemplates ? undefined : 'Fill the payload from a JSON Schema and check it.'}
        checked={showTemplates}
        onChange={setShowTemplates}
      >
        <div className="template-header">
          <div className="template-actions">
            <label
              className="template-action-btn import-btn"
              title="Import a JSON Schema or exported message schemas"
            >
              <input
                type="file"
                accept=".json"
                onChange={handleTemplateImport}
                style={{ display: 'none' }}
              />
              <i className="fas fa-upload"></i>
            </label>
            <button
              type="button"
              className="template-action-btn export-btn"
              onClick={handleTemplateExport}
              disabled={messageTemplates.length === 0}
              title="Export message schemas"
            >
              <i className="fas fa-download"></i>
            </button>
          </div>
        </div>
        <div className="template-select-wrapper custom-select-wrapper">
          <button
            type="button"
            className="custom-select-button"
            onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
            disabled={isPublishing}
          >
            <span className="select-value">{getSelectedTemplateName()}</span>
            <i className={`fas fa-chevron-down ${showTemplateDropdown ? 'rotated' : ''}`}></i>
          </button>

          {showTemplateDropdown && (
            <div className="custom-select-dropdown">
              <button
                type="button"
                className={`dropdown-option ${!selectedTemplate ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedTemplate(null);
                  setSchemaValidation(null);
                  setShowTemplateDropdown(false);
                }}
              >
                Choose a message schema
              </button>
              {messageTemplates.map((template) => (
                <div key={template.id} className="template-dropdown-item">
                  <button
                    type="button"
                    className={`dropdown-option ${selectedTemplate === template.id ? 'selected' : ''}`}
                    onClick={() => handleTemplateSelect(template.id)}
                  >
                    <div className="template-info">
                      <span className="template-name">{template.name}</span>
                      {template.category && (
                        <span className="template-category">{template.category}</span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="template-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTemplateDelete(template.id);
                    }}
                    title="Delete this message schema"
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CheckToggle>
    </div>
  );
}

export default React.memo(TemplatesSection);
