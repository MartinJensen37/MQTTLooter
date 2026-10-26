import { useEffect, useState } from 'react';
import CloseButton from '../Controls/CloseButton';
import { APP_INFO, type AppVersions } from '../../../../shared/app-info';
import logo from '../../assets/MQTTLooter_logo_small.png';
import './AboutDialog.css';

/** Help > About: version, runtime, license and a link to the repository. */
export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const [versions, setVersions] = useState<AppVersions>();
  useEffect(() => {
    void window.electronAPI.app.info().then((result) => {
      if (result.success && result.data) setVersions(result.data);
    });
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal-container about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="modal-header">
          <h2 id="about-title">About {APP_INFO.name}</h2>
          <CloseButton onClick={onClose} label="Close about" />
        </div>
        <div className="about-body">
          <img className="about-logo" src={logo} alt="" />
          <p className="about-name">{APP_INFO.name}</p>
          <p className="about-version">Version {versions?.app ?? '…'}</p>
          {versions && (
            <p className="about-runtime">
              Electron {versions.electron} · Chromium {versions.chrome} · Node.js {versions.node}
            </p>
          )}
          <p className="about-license">
            Released under the {APP_INFO.license} License.
            <br />
            {APP_INFO.copyright}
          </p>
          <button
            className="btn btn-md btn-primary"
            onClick={() => void window.electronAPI.app.openRepository()}
          >
            <i className="fab fa-github"></i> View on GitHub
          </button>
          <p className="about-repository">{APP_INFO.repository.replace('https://', '')}</p>
        </div>
      </div>
    </div>
  );
}
