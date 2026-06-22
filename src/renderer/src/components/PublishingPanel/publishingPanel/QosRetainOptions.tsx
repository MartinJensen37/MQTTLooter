import React from 'react';

interface Props {
  qos: number;
  setQos: React.Dispatch<React.SetStateAction<number>>;
  retain: boolean;
  setRetain: React.Dispatch<React.SetStateAction<boolean>>;
  isPublishing: boolean;
  showQosDropdown: boolean;
  setShowQosDropdown: React.Dispatch<React.SetStateAction<boolean>>;
}

function QosRetainOptions({
  qos,
  setQos,
  retain,
  setRetain,
  isPublishing,
  showQosDropdown,
  setShowQosDropdown,
}: Props) {
  return (
    <div className="form-options">
      <div className="form-group">
        <label htmlFor="qos">Quality of Service:</label>
        <div className="qos-select-wrapper custom-select-wrapper large">
          <button
            type="button"
            className="custom-select-button"
            onClick={() => setShowQosDropdown(!showQosDropdown)}
            disabled={isPublishing}
          >
            <span className="select-value">
              QoS {qos} -{' '}
              {qos === 0 ? 'At most once' : qos === 1 ? 'At least once' : 'Exactly once'}
            </span>
            <i className={`fas fa-chevron-down ${showQosDropdown ? 'rotated' : ''}`}></i>
          </button>

          {showQosDropdown && (
            <div className="custom-select-dropdown">
              <button
                type="button"
                className={`dropdown-option ${qos === 0 ? 'selected' : ''}`}
                onClick={() => {
                  setQos(0);
                  setShowQosDropdown(false);
                }}
              >
                QoS 0 - At most once
              </button>
              <button
                type="button"
                className={`dropdown-option ${qos === 1 ? 'selected' : ''}`}
                onClick={() => {
                  setQos(1);
                  setShowQosDropdown(false);
                }}
              >
                QoS 1 - At least once
              </button>
              <button
                type="button"
                className={`dropdown-option ${qos === 2 ? 'selected' : ''}`}
                onClick={() => {
                  setQos(2);
                  setShowQosDropdown(false);
                }}
              >
                QoS 2 - Exactly once
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="form-group retain-group">
        <label htmlFor="retain" className="retain-checkbox-label">
          <input
            id="retain"
            type="checkbox"
            checked={retain}
            onChange={(e) => setRetain(e.target.checked)}
            disabled={isPublishing}
          />
          <span className="retain-checkbox-custom"></span>
          <span className="retain-checkbox-text">
            Retain message
            <span
              className="retain-info"
              title="Retained messages are stored by the broker and sent to new subscribers"
            >
              <i className="fas fa-info-circle"></i>
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

export default React.memo(QosRetainOptions);
