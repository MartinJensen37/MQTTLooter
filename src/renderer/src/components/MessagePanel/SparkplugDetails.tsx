import { useEffect, useState } from 'react';
import CheckToggle from '../Controls/CheckToggle';
import SparkplugBadge from '../Controls/SparkplugBadge';
import TopicTreeService from '../../services/TopicTreeService';
import {
  decodeSparkplug,
  requestRebirth,
  type DecodedSparkplug,
  type SparkplugMetricValue,
} from '../../services/Sparkplug';
import {
  parseSparkplugTopic,
  sparkplugTopic,
  type SparkplugMessageType,
} from '../../../../shared/sparkplug';
import { clockTime, dateTime } from '../../utils/time';
import './SparkplugDetails.css';

const MAX_ROWS = 200;

interface State {
  online: boolean | null;
  since?: number;
}
interface Snapshot {
  node: State;
  device?: State;
  seq?: number;
  bdSeq?: unknown;
  metrics: [string, SparkplugMetricValue][];
}

/** Online after a birth, offline after a death; a node's death also takes its devices offline. */
function lifecycle(birth?: number | null, death?: number | null): State {
  if (!birth && !death) return { online: null };
  return (birth ?? 0) > (death ?? 0)
    ? { online: true, since: birth! }
    : { online: false, since: death! };
}

function display(metric: SparkplugMetricValue): string {
  const { value, type } = metric;
  if (value === null) return 'null';
  if (type === 'DateTime' && typeof value === 'number') return `${dateTime(value)} (${value})`;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function StateText({ state }: { state: State }) {
  if (state.online === null) return <span className="spb-state">No birth or death seen yet</span>;
  return (
    <span className={`spb-state ${state.online ? 'online' : 'offline'}`}>
      <span className="spb-state-dot" aria-hidden="true" />
      {state.online ? 'Online' : 'Offline'} since {clockTime(state.since!)}
    </span>
  );
}

/** Logging > topic details for a Sparkplug B topic: node state, sequence, metrics and rebirth. */
export default function SparkplugDetails({
  connectionId,
  topic,
  showFeedback,
}: {
  connectionId: string;
  topic: string;
  showFeedback?: (message: string, type?: string) => void;
}) {
  const source = parseSparkplugTopic(topic);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setSnapshot(undefined);
    const source = parseSparkplugTopic(topic);
    if (!open || !source) return;
    let disposed = false;
    let signature = '';
    let timer: ReturnType<typeof setTimeout>;
    // Births, deaths and data of this edge node (and device) are separate topics, so poll
    // their latest arrival times and decode again only when one changes.
    const refresh = async () => {
      const tree = TopicTreeService.getTopicTree(connectionId);
      const at = (messageType: SparkplugMessageType, device?: string) =>
        tree?.getNode(sparkplugTopic({ ...source, messageType, device }));
      const device = source.device;
      const nodes = {
        nodeBirth: at('NBIRTH'),
        nodeDeath: at('NDEATH'),
        deviceBirth: device ? at('DBIRTH', device) : undefined,
        deviceDeath: device ? at('DDEATH', device) : undefined,
        data: device ? at('DDATA', device) : at('NDATA'),
      };
      const next = Object.values(nodes)
        .map((node) => node?.lastMessageTime ?? '')
        .join('|');
      if (next !== signature) {
        signature = next;
        const decode = (node: (typeof nodes)['data']) =>
          node?.lastMessage
            ? decodeSparkplug(
                node.lastMessage.payload,
                node.lastMessage.encoding ?? 'utf8',
                node.fullPath,
              ).catch(() => undefined)
            : Promise.resolve(undefined);
        const birthNode = device ? nodes.deviceBirth : nodes.nodeBirth;
        const [birth, data, nodeBirth] = await Promise.all([
          decode(birthNode),
          decode(nodes.data),
          device ? decode(nodes.nodeBirth) : undefined,
        ]);
        if (disposed) return;
        const node = lifecycle(nodes.nodeBirth?.lastMessageTime, nodes.nodeDeath?.lastMessageTime);
        let deviceState: State | undefined;
        if (device) {
          deviceState = lifecycle(
            nodes.deviceBirth?.lastMessageTime,
            nodes.deviceDeath?.lastMessageTime,
          );
          if (node.online === false && deviceState.online && node.since! > deviceState.since!)
            deviceState = node;
        }
        // The birth declares every metric; the latest data message updates what changed.
        const metrics = new Map(Object.entries(birth?.metrics ?? {}));
        const newer =
          (nodes.data?.lastMessageTime ?? 0) >= (birthNode?.lastMessageTime ?? 0)
            ? data
            : undefined;
        for (const [name, metric] of Object.entries(newer?.metrics ?? {}))
          metrics.set(name, { ...metrics.get(name), ...metric });
        const latest: DecodedSparkplug | undefined = newer ?? birth;
        setSnapshot({
          node,
          device: deviceState,
          seq: latest?.seq,
          bdSeq: (nodeBirth ?? (device ? undefined : birth))?.metrics.bdSeq?.value,
          metrics: [...metrics],
        });
      }
      if (!disposed) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [open, connectionId, topic]);

  if (!source) return null;
  const rebirth = async () => {
    setSending(true);
    try {
      await requestRebirth(connectionId, source);
      showFeedback?.(`Rebirth requested from ${source.edgeNode}.`, 'success');
    } catch (error) {
      showFeedback?.(`Rebirth request failed: ${(error as Error).message}`, 'error');
    } finally {
      setSending(false);
    }
  };
  const unnamed = snapshot?.metrics.some(([name]) => name.startsWith('Alias '));
  return (
    <CheckToggle
      className="spb-details"
      checked={open}
      onChange={setOpen}
      label={
        <>
          <SparkplugBadge /> Sparkplug B
        </>
      }
      hint="Edge node state, sequence numbers and the latest metric values."
    >
      <dl className="spb-facts">
        <div>
          <dt>Edge node</dt>
          <dd>
            {source.group} / {source.edgeNode}
            {snapshot && <StateText state={snapshot.node} />}
          </dd>
        </div>
        {source.device && (
          <div>
            <dt>Device</dt>
            <dd>
              {source.device}
              {snapshot?.device && <StateText state={snapshot.device} />}
            </dd>
          </div>
        )}
        <div>
          <dt>Sequence</dt>
          <dd>
            seq {snapshot?.seq ?? '–'} · bdSeq {String(snapshot?.bdSeq ?? '–')}
          </dd>
        </div>
      </dl>
      <div className="spb-actions">
        <button
          className="btn btn-sm btn-secondary"
          onClick={rebirth}
          disabled={sending}
          title={`Publish Node Control/Rebirth to ${sparkplugTopic({ ...source, messageType: 'NCMD', device: undefined })}`}
        >
          <i className="fas fa-redo" /> Request rebirth
        </button>
        {unnamed && (
          <span className="spb-note">
            Some metrics have only an alias. A rebirth sends their names.
          </span>
        )}
      </div>
      {snapshot && snapshot.metrics.length > 0 ? (
        <table className="spb-metrics">
          <caption>Metrics ({snapshot.metrics.length})</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.metrics.slice(0, MAX_ROWS).map(([name, metric]) => (
              <tr key={name}>
                <td title={metric.alias !== undefined ? `Alias ${metric.alias}` : undefined}>
                  {name}
                </td>
                <td>{metric.type}</td>
                <td>{display(metric)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="spb-note">
          {snapshot ? 'No metrics received yet.' : 'Reading the latest Sparkplug messages…'}
        </p>
      )}
      {snapshot && snapshot.metrics.length > MAX_ROWS && (
        <p className="spb-note">Showing the first {MAX_ROWS} metrics.</p>
      )}
    </CheckToggle>
  );
}
