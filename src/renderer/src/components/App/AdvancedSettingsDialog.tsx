import { useEffect, useState } from 'react';
import CheckToggle from '../Controls/CheckToggle';
import InfoTip from '../Controls/InfoTip';
import TopicTreeService from '../../services/TopicTreeService';
import MQTTService from '../../services/MQTTService';
import { advancedSettings, useAdvancedSettings } from '../../services/AdvancedSettings';
import { useDecoders } from '../../services/DecoderRegistry';
import { HISTORY_PROFILES, type HistoryProfile } from '../../config';
import type { TrafficStatus } from '../../../../shared/traffic';
import './AdvancedSettingsDialog.css';

const mib = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MiB`;
const profileLabel = (profile: HistoryProfile) =>
  `${profile === 'larger' ? 'Larger' : 'Compact'}: ${HISTORY_PROFILES[profile].maxNodes.toLocaleString()} topics, ${mib(HISTORY_PROFILES[profile].maxBytes)} per connection`;

/** Tools > Advanced settings: options that are rarely changed. */
export default function AdvancedSettingsDialog({
  connections,
  onClose,
}: {
  connections: { id: string; name: string }[];
  onClose: () => void;
}) {
  const settings = useAdvancedSettings();
  const { decoders } = useDecoders();
  const [profile, setProfile] = useState<HistoryProfile>(
    () => TopicTreeService.getHistorySettings().profile,
  );
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [traffic, setTraffic] = useState<TrafficStatus>();
  const [error, setError] = useState('');

  useEffect(() => {
    void window.electronAPI.history.status().then((result) => {
      if (result.success) setPersistent(result.data?.store?.persistent ?? false);
    });
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const refresh = async () => {
      try {
        const status = await MQTTService.getTrafficStatus();
        if (!disposed) setTraffic(status);
      } catch {
        /* Counts stay as last shown. */
      }
      if (!disposed) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);

  const counted = connections.filter((connection) => traffic?.connections[connection.id]);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal-container advanced-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="advanced-settings-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="modal-header">
          <h2 id="advanced-settings-title">Advanced settings</h2>
          <button
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close advanced settings"
          >
            ×
          </button>
        </div>
        <div className="advanced-settings-body">
          <section>
            <h3>Topic tree</h3>
            <label className="advanced-settings-field">
              <span>
                Cache size
                <InfoTip text="Messages kept in memory for browsing. Older messages are still on disk." />
              </span>
              <select
                className="form-select"
                aria-label="Cache size"
                value={profile}
                onChange={(event) => {
                  const next = event.target.value as HistoryProfile;
                  if (TopicTreeService.setHistoryProfile(next)) {
                    setProfile(next);
                    setError('');
                  } else setError('Unpin topics before choosing a smaller cache.');
                }}
              >
                <option value="larger">{profileLabel('larger')}</option>
                <option value="compact">{profileLabel('compact')}</option>
              </select>
            </label>
          </section>
          <section>
            <h3>Disk history</h3>
            <CheckToggle
              label="Keep disk history after closing the app"
              hint="When off, stored messages are deleted when the app closes. Up to 24 hours are kept."
              checked={persistent ?? false}
              disabled={persistent === null}
              onChange={async (enabled) => {
                const result = await window.electronAPI.history.persist(enabled);
                if (result.success) setPersistent(enabled);
                else setError(result.error ?? 'Could not save this setting.');
              }}
            />
          </section>
          <section>
            <h3>Publishing</h3>
            <CheckToggle
              label="Choose the payload encoding"
              hint="Publish binary payloads written as base64 instead of text."
              checked={settings.payloadEncoding}
              onChange={(payloadEncoding) => advancedSettings.set({ payloadEncoding })}
            />
          </section>
          <section>
            <h3>Decoding</h3>
            <CheckToggle
              label="Protobuf decoders"
              hint={
                decoders.length
                  ? `Shown while ${decoders.length} saved decoder${decoders.length === 1 ? ' is' : 's are'} in use.`
                  : 'Adds a Decoders button to Logging for .proto files.'
              }
              checked={settings.protobufDecoders || decoders.length > 0}
              disabled={decoders.length > 0}
              onChange={(protobufDecoders) => advancedSettings.set({ protobufDecoders })}
            />
          </section>
          <section>
            <h3>Message delivery</h3>
            {counted.length ? (
              <dl className="advanced-settings-delivery">
                {counted.map(({ id, name }) => {
                  const counts = traffic!.connections[id];
                  return (
                    <div key={id}>
                      <dt>{name}</dt>
                      <dd>
                        {counts.received.toLocaleString()} received ·{' '}
                        {counts.processed.toLocaleString()} shown ·{' '}
                        {counts.dropped.toLocaleString()} dropped
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="advanced-settings-note">No messages received since the app started.</p>
            )}
          </section>
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-md btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
