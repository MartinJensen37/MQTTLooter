import { useEffect, useState } from 'react';
import CloseButton from '../Controls/CloseButton';
import { APP_INFO, type AppVersions } from '../../../../shared/app-info';
import type { ConnectionConfig } from '../../../../shared/connection';
import { windowDiagnostics } from '../../utils/diagnostics';
import logo from '../../assets/MQTTLooter_logo_small.png';
import './AboutDialog.css';

/** Help > About: version, runtime, license, a link to the repository and diagnostics. */
export default function AboutDialog({
  onClose,
  connections = [],
}: {
  onClose: () => void;
  connections?: { id: string; config: ConnectionConfig; isConnected?: boolean }[];
}) {
  const [versions, setVersions] = useState<AppVersions>();
  const [diagnostics, setDiagnostics] = useState('');
  const saveDiagnostics = async () => {
    const result = await window.electronAPI.app.saveDiagnostics(windowDiagnostics(connections));
    if (!result.success) setDiagnostics(`Diagnostics could not be saved: ${result.error}`);
    else if (result.data?.saved) setDiagnostics(`Saved to ${result.data.path}`);
  };
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
          <div className="about-diagnostics">
            <button className="btn btn-sm btn-secondary" onClick={() => void saveDiagnostics()}>
              <i className="fas fa-file-medical"></i> Save diagnostics
            </button>
            <p>
              For a bug report: versions, settings, connection options and recent errors. Topics,
              payloads, passwords and broker addresses are left out, although an error message can
              name the address it failed to reach.
            </p>
            {diagnostics && <p role="status">{diagnostics}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
