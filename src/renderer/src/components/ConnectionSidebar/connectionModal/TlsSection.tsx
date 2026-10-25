import React from 'react';
import SecretInput from './SecretInput';
import type { ConnectionFormData, FieldChange, CertFileType } from './types';
import InfoTip from '../../Controls/InfoTip';

interface Props {
  formData: ConnectionFormData;
  handleInputChange: FieldChange;
  handleFileSelect: (fileType: CertFileType, event: React.ChangeEvent<HTMLInputElement>) => void;
  clearCertificateFile: (fileType: CertFileType) => void;
}

function TlsSection({
  formData,
  handleInputChange,
  handleFileSelect,
  clearCertificateFile,
}: Props) {
  return (
    <div className="mqtt-form-section">
      <h3 className="mqtt-section-title">TLS/SSL Configuration</h3>

      <div className="mqtt-form-group">
        <label className="mqtt-connection-modal-checkbox-label">
          <input
            type="checkbox"
            checked={formData.tls.enabled}
            onChange={(e) =>
              handleInputChange('tls', { ...formData.tls, enabled: e.target.checked })
            }
          />
          <div className="mqtt-connection-modal-checkbox-custom"></div>
          <span className="mqtt-connection-modal-checkbox-text">
            Enable TLS/SSL{' '}
            <InfoTip text="Encrypts the connection. Required for mqtts:// and wss://." />
          </span>
        </label>
      </div>

      {(formData.tls.enabled || formData.protocol === 'mqtts' || formData.protocol === 'wss') && (
        <>
          <div className="mqtt-form-group">
            <label className="mqtt-connection-modal-checkbox-label">
              <input
                type="checkbox"
                checked={formData.tls.rejectUnauthorized}
                onChange={(e) =>
                  handleInputChange('tls', {
                    ...formData.tls,
                    rejectUnauthorized: e.target.checked,
                  })
                }
              />
              <div className="mqtt-connection-modal-checkbox-custom"></div>
              <span className="mqtt-connection-modal-checkbox-text">
                Verify Server Certificate{' '}
                <InfoTip text="Turn off only to test with self-signed certificates." />
              </span>
            </label>
          </div>

          <div className="mqtt-form-group">
            <label htmlFor="servername">
              Server Name (SNI) <InfoTip text="Name checked against the broker's certificate." />
            </label>
            <input
              id="servername"
              type="text"
              value={formData.tls.servername}
              onChange={(e) =>
                handleInputChange('tls', { ...formData.tls, servername: e.target.value })
              }
              placeholder="Defaults to the host"
              autoComplete="off"
            />
          </div>

          {/* CA Certificate */}
          <div className="mqtt-form-group">
            <label>
              CA Certificate (Optional){' '}
              <InfoTip text="Certificate of the authority that signed the broker's certificate." />
            </label>
            <div className="mqtt-certificate-upload">
              <input
                type="file"
                accept=".crt,.pem,.cer"
                onChange={(e) => handleFileSelect('ca', e)}
                style={{ display: 'none' }}
                id="ca-cert-upload"
              />
              <label htmlFor="ca-cert-upload" className="mqtt-file-upload-btn">
                <i className="fas fa-upload"></i>
                Choose CA Certificate
              </label>
              {formData.tls.ca && (
                <div className="mqtt-certificate-info">
                  <div className="mqtt-cert-details">
                    <span className="mqtt-cert-name">{formData.tls.ca.name}</span>
                    <span className="mqtt-cert-size">
                      ({(formData.tls.ca.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearCertificateFile('ca')}
                    className="mqtt-cert-remove"
                    title="Remove certificate"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Client Certificate */}
          <div className="mqtt-form-group">
            <label>
              Client Certificate (Optional){' '}
              <InfoTip text="For brokers that require a client certificate." />
            </label>
            <div className="mqtt-certificate-upload">
              <input
                type="file"
                accept=".crt,.pem,.cer"
                onChange={(e) => handleFileSelect('cert', e)}
                style={{ display: 'none' }}
                id="client-cert-upload"
              />
              <label htmlFor="client-cert-upload" className="mqtt-file-upload-btn">
                <i className="fas fa-upload"></i>
                Choose Client Certificate
              </label>
              {formData.tls.cert && (
                <div className="mqtt-certificate-info">
                  <div className="mqtt-cert-details">
                    <span className="mqtt-cert-name">{formData.tls.cert.name}</span>
                    <span className="mqtt-cert-size">
                      ({(formData.tls.cert.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearCertificateFile('cert')}
                    className="mqtt-cert-remove"
                    title="Remove certificate"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Private Key */}
          <div className="mqtt-form-group">
            <label>
              Private Key (Optional) <InfoTip text="Private key of the client certificate." />
            </label>
            <div className="mqtt-certificate-upload">
              <input
                type="file"
                accept=".key,.pem"
                onChange={(e) => handleFileSelect('key', e)}
                style={{ display: 'none' }}
                id="private-key-upload"
              />
              <label htmlFor="private-key-upload" className="mqtt-file-upload-btn">
                <i className="fas fa-upload"></i>
                Choose Private Key
              </label>
              {formData.tls.key && (
                <div className="mqtt-certificate-info">
                  <div className="mqtt-cert-details">
                    <span className="mqtt-cert-name">{formData.tls.key.name}</span>
                    <span className="mqtt-cert-size">
                      ({(formData.tls.key.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearCertificateFile('key')}
                    className="mqtt-cert-remove"
                    title="Remove key"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Passphrase for private key */}
          {formData.tls.key && (
            <div className="mqtt-form-group">
              <label htmlFor="key-passphrase">
                Private Key Passphrase <InfoTip text="Unlocks an encrypted private key." />
              </label>
              <SecretInput
                label="key passphrase"
                id="key-passphrase"
                value={formData.tls.passphrase}
                onChange={(e) =>
                  handleInputChange('tls', { ...formData.tls, passphrase: e.target.value })
                }
                placeholder="Only for an encrypted key"
                autoComplete="new-password"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(TlsSection);
