import { useEffect, useRef, useState, type ReactNode } from 'react';
import CheckToggle from '../Controls/CheckToggle';
import InfoTip from '../Controls/InfoTip';
import CloseButton from '../Controls/CloseButton';
import TopicTreeService from '../../services/TopicTreeService';
import MQTTService from '../../services/MQTTService';
import { settings as store, useSettings, type Settings } from '../../services/Settings';
import { useDecoders } from '../../services/DecoderRegistry';
import { HISTORY_PROFILES, MESSAGE_HISTORY, type HistoryProfile } from '../../config';
import type { TrafficStatus } from '../../../../shared/traffic';
import './SettingsDialog.css';

const mib = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MiB`;
const profileLabel = (profile: HistoryProfile) =>
  `${profile === 'larger' ? 'Larger' : 'Compact'}: ${HISTORY_PROFILES[profile].maxNodes.toLocaleString()} topics, ${mib(HISTORY_PROFILES[profile].maxBytes)} per connection`;
const SECTIONS = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['storage', 'Messages & storage'],
  ['features', 'Features'],
] as const;

/** A labelled select bound to one setting. */
function Choice<K extends keyof Settings>({
  setting,
  label,
  options,
  info,
}: {
  setting: K;
  label: string;
  options: [Settings[K], string][];
  info?: string;
}) {
  const value = useSettings()[setting];
  return (
    <label className="settings-field">
      <span>
        {label}
        {info && <InfoTip text={info} />}
      </span>
      <select
        className="form-select"
        aria-label={label}
        value={String(value)}
        onChange={(event) => {
          const chosen = options.find(([option]) => String(option) === event.target.value);
          if (chosen) store.set({ [setting]: chosen[0] } as Partial<Settings>);
        }}
      >
        {options.map(([option, text]) => (
          <option key={String(option)} value={String(option)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <h3 id={`settings-${id}-title`}>{title}</h3>
      {children}
    </section>
  );
}

/** Tools > Settings: preferences, appearance, storage and optional features. */
export default function SettingsDialog({
  connections,
  onClose,
}: {
  connections: { id: string; name: string }[];
  onClose: () => void;
}) {
  const current = useSettings();
  const { decoders } = useDecoders();
  const [profile, setProfile] = useState<HistoryProfile>(
    () => TopicTreeService.getHistorySettings().profile,
  );
  const [perTopic, setPerTopic] = useState(
    () => TopicTreeService.getHistorySettings().messagesPerTopic,
  );
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [traffic, setTraffic] = useState<TrafficStatus>();
  const [error, setError] = useState('');
  const [section, setSection] = useState<string>('general');
  const body = useRef<HTMLDivElement>(null);

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

  // The side menu follows scrolling: the last section whose title has passed the top, or the
  // last section once the end is reached, since it is too short to scroll to the top.
  const followScroll = () => {
    const element = body.current;
    if (!element) return;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2) {
      setSection(SECTIONS[SECTIONS.length - 1][0]);
      return;
    }
    const top = element.getBoundingClientRect().top;
    let visible: string = SECTIONS[0][0];
    for (const [id] of SECTIONS) {
      const heading = document.getElementById(`settings-${id}`);
      if (heading && heading.getBoundingClientRect().top - top < 40) visible = id;
    }
    setSection(visible);
  };
  const counted = connections.filter((connection) => traffic?.connections[connection.id]);
  const perTopicChoices = [...new Set([...MESSAGE_HISTORY.ITEMS_PER_TOPIC_CHOICES, perTopic])].sort(
    (a, b) => a - b,
  );
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal-container settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <CloseButton onClick={onClose} label="Close settings" />
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map(([id, title]) => (
              <button
                key={id}
                aria-current={section === id ? 'true' : undefined}
                onClick={() => {
                  document
                    .getElementById(`settings-${id}`)
                    ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                  setSection(id);
                }}
              >
                {title}
              </button>
            ))}
          </nav>
          <div className="settings-body" ref={body} onScroll={followScroll}>
            <Section id="general" title="General">
              <Choice
                setting="payloadView"
                label="Message card view"
                info="Auto indents JSON, shows binary payloads as hex and decodes protobuf when a decoder matches."
                options={[
                  ['auto', 'Auto'],
                  ['text', 'Text as received'],
                  ['hex', 'Hex bytes'],
                ]}
              />
              <Choice
                setting="timeFormat"
                label="Time format"
                options={[
                  ['system', 'System default'],
                  ['24h', '24-hour'],
                  ['12h', '12-hour'],
                ]}
              />
            </Section>
            <Section id="appearance" title="Appearance">
              <Choice
                setting="theme"
                label="Theme"
                info="System follows the Windows light or dark mode."
                options={[
                  ['system', 'System'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
              />
              <Choice
                setting="textSize"
                label="Text size"
                options={[
                  [90, '90%'],
                  [100, '100%'],
                  [110, '110%'],
                  [125, '125%'],
                ]}
              />
              <Choice
                setting="uiFont"
                label="Interface font"
                options={[
                  ['system', 'System'],
                  ['segoe', 'Segoe UI'],
                  ['arial', 'Arial'],
                  ['verdana', 'Verdana'],
                ]}
              />
              <Choice
                setting="codeFont"
                label="Payload font"
                options={[
                  ['system', 'System'],
                  ['consolas', 'Consolas'],
                  ['cascadia', 'Cascadia Mono'],
                  ['courier', 'Courier New'],
                ]}
              />
            </Section>
            <Section id="storage" title="Messages & storage">
              <label className="settings-field">
                <span>
                  Messages per topic
                  <InfoTip text="Messages each topic keeps in memory for the message list. Disk history keeps more." />
                </span>
                <select
                  className="form-select"
                  aria-label="Messages per topic"
                  value={perTopic}
                  onChange={(event) => {
                    const count = Number(event.target.value);
                    if (TopicTreeService.setMessagesPerTopic(count)) setPerTopic(count);
                  }}
                >
                  {perTopicChoices.map((count) => (
                    <option key={count} value={count}>
                      {count.toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>
                  Cache size
                  <InfoTip text="Memory for topics and messages per connection. Older messages are still on disk." />
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
              <h4>Message delivery</h4>
              {counted.length ? (
                <dl className="settings-delivery">
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
                <p className="settings-note">No messages received since the app started.</p>
              )}
            </Section>
            <Section id="features" title="Features">
              <CheckToggle
                label="Choose the payload encoding"
                hint="Publish binary payloads written as base64 instead of text."
                checked={current.payloadEncoding}
                onChange={(payloadEncoding) => store.set({ payloadEncoding })}
              />
              <CheckToggle
                label="Protobuf decoders"
                hint={
                  decoders.length
                    ? `Shown while ${decoders.length} saved decoder${decoders.length === 1 ? ' is' : 's are'} in use.`
                    : 'Adds a Decoders button to Logging for .proto files.'
                }
                checked={current.protobufDecoders || decoders.length > 0}
                disabled={decoders.length > 0}
                onChange={(protobufDecoders) => store.set({ protobufDecoders })}
              />
              <CheckToggle
                label="Sparkplug B"
                hint="Decodes spBv1.0 topics and adds Sparkplug tools to Logging, Publishing and Simulation."
                checked={current.sparkplug}
                onChange={(sparkplug) => store.set({ sparkplug })}
              />
            </Section>
            {error && <p role="alert">{error}</p>}
          </div>
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
