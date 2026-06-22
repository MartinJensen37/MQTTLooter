import React from 'react';
import type { ConnectionFormData, FieldChange, CertFileType } from './types';

interface Props {
  formData: ConnectionFormData;
  handleInputChange: FieldChange;
  handleFileSelect: (fileType: CertFileType, event: React.ChangeEvent<HTMLInputElement>) => void;
  clearCertificateFile: (fileType: CertFileType) => void;
}

function TlsSection({ formData, handleInputChange, handleFileSelect, clearCertificateFile }: Props) {
  return (
    <div className="mqtt-form-section">
      <h3 className="mqtt-section-title">TLS/SSL Configuration</h3>

      <div className="mqtt-form-group">
        <label className="mqtt-connection-modal-checkbox-label">
          <input
            type="checkbox"
            checked={formData.tls.enabled}
            onChange={(e) => handleInputChange('tls', { ...formData.tls, enabled: e.target.checked })}
          />
          <div className="mqtt-connection-modal-checkbox-custom"></div>
          <span className="mqtt-connection-modal-checkbox-text">Enable TLS/SSL</span>
        </label>
        <div className="mqtt-field-hint">
          Enable secure connection using TLS/SSL (required for mqtts:// and wss://)
        </div>
      </div>

      {(formData.tls.enabled || formData.protocol === 'mqtts' || formData.protocol === 'wss') && (
        <>
          <div className="mqtt-form-group">
            <label className="mqtt-connection-modal-checkbox-label">
              <input
                type="checkbox"
                checked={formData.tls.rejectUnauthorized}
                onChange={(e) =>
                  handleInputChange('tls', { ...formData.tls, rejectUnauthorized: e.target.checked })
                }
              />
              <div className="mqtt-connection-modal-checkbox-custom"></div>
              <span className="mqtt-connection-modal-checkbox-text">Verify Server Certificate</span>
            </label>
            <div className="mqtt-field-hint">
              Uncheck to allow self-signed certificates (not recommended for production)
            </div>
          </div>

          <div className="mqtt-form-group">
            <label htmlFor="servername">Server Name (SNI)</label>
            <input
              id="servername"
              type="text"
              value={formData.tls.servername}
              onChange={(e) =>
                handleInputChange('tls', { ...formData.tls, servername: e.target.value })
              }
              placeholder="Optional - override hostname for SNI"
              autoComplete="off"
            />
            <div className="mqtt-field-hint">
              Server Name Indication - leave empty to use hostname
            </div>
          </div>

          {/* CA Certificate */}
          <div className="mqtt-form-group">
            <label>CA Certificate (Optional)</label>
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
            <div className="mqtt-field-hint">
              Certificate Authority certificate for server verification
            </div>
          </div>

          {/* Client Certificate */}
          <div className="mqtt-form-group">
            <label>Client Certificate (Optional)</label>
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
            <div className="mqtt-field-hint">
              Client certificate for mutual TLS authentication
            </div>
          </div>

          {/* Private Key */}
          <div className="mqtt-form-group">
            <label>Private Key (Optional)</label>
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
            <div className="mqtt-field-hint">
              Private key corresponding to the client certificate
            </div>
          </div>

          {/* Passphrase for private key */}
          {formData.tls.key && (
            <div className="mqtt-form-group">
              <label htmlFor="key-passphrase">Private Key Passphrase</label>
              <input
                id="key-passphrase"
                type="password"
                value={formData.tls.passphrase}
                onChange={(e) =>
                  handleInputChange('tls', { ...formData.tls, passphrase: e.target.value })
                }
                placeholder="Leave empty if key is not encrypted"
                autoComplete="new-password"
              />
              <div className="mqtt-field-hint">Passphrase for encrypted private key</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(TlsSection);
