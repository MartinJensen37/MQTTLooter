import React from 'react';
import type { ConnectionFormData, FormErrors } from './types';

interface Props {
  formData: ConnectionFormData;
  errors: FormErrors;
  handleSubscriptionChange: (index: number, field: 'topic' | 'qos', value: string | number) => void;
  addSubscription: () => void;
  removeSubscription: (index: number) => void;
  subscriptionQosDropdowns: Record<number, boolean>;
  toggleSubscriptionQosDropdown: (index: number) => void;
}

function SubscriptionsSection({
  formData,
  errors,
  handleSubscriptionChange,
  addSubscription,
  removeSubscription,
  subscriptionQosDropdowns,
  toggleSubscriptionQosDropdown,
}: Props) {
  return (
    <div className="mqtt-form-section">
      <div className="mqtt-section-header">
        <h3 className="mqtt-section-title">Subscriptions</h3>
        <button type="button" onClick={addSubscription} className="mqtt-add-btn">
          + Add Topic
        </button>
      </div>

      {formData.subscriptions.map((subscription, index) => (
        <div key={index} className="mqtt-subscription-row">
          <div className="mqtt-form-group mqtt-topic-group">
            <label htmlFor={`topic-${index}`}>Topic</label>
            <input
              id={`topic-${index}`}
              type="text"
              value={subscription.topic}
              onChange={(e) => handleSubscriptionChange(index, 'topic', e.target.value)}
              placeholder="Topic (e.g., sensors/+/temperature)"
              className={errors[`subscription_${index}`] ? 'error' : ''}
              autoComplete="off"
            />
            {errors[`subscription_${index}`] && (
              <span className="mqtt-error-text">{errors[`subscription_${index}`]}</span>
            )}
          </div>

          <div className="mqtt-form-group mqtt-qos-group">
            <label htmlFor={`qos-${index}`}>QoS</label>
            <div className="custom-select-wrapper small qos-select-wrapper">
              <button
                type="button"
                className="custom-select-button"
                onClick={() => toggleSubscriptionQosDropdown(index)}
              >
                <span className="select-value">{subscription.qos}</span>
                <i
                  className={`fas fa-chevron-down ${subscriptionQosDropdowns[index] ? 'rotated' : ''}`}
                ></i>
              </button>
              {subscriptionQosDropdowns[index] && (
                <div className="custom-select-dropdown">
                  <button
                    type="button"
                    className={`dropdown-option ${subscription.qos == 0 ? 'selected' : ''}`}
                    onClick={() => {
                      handleSubscriptionChange(index, 'qos', 0);
                      toggleSubscriptionQosDropdown(index);
                    }}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    className={`dropdown-option ${subscription.qos == 1 ? 'selected' : ''}`}
                    onClick={() => {
                      handleSubscriptionChange(index, 'qos', 1);
                      toggleSubscriptionQosDropdown(index);
                    }}
                  >
                    1
                  </button>
                  <button
                    type="button"
                    className={`dropdown-option ${subscription.qos == 2 ? 'selected' : ''}`}
                    onClick={() => {
                      handleSubscriptionChange(index, 'qos', 2);
                      toggleSubscriptionQosDropdown(index);
                    }}
                  >
                    2
                  </button>
                </div>
              )}
            </div>
          </div>

          {formData.subscriptions.length > 1 && (
            <button
              type="button"
              onClick={() => removeSubscription(index)}
              className="mqtt-remove-btn"
              title="Remove subscription"
            >
              <i className="fas fa-trash"></i>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default React.memo(SubscriptionsSection);
