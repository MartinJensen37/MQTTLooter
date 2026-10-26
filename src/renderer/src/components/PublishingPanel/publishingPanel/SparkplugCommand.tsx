import { useEffect, useId, useRef, useState } from 'react';
import CheckToggle from '../../Controls/CheckToggle';
import SparkplugBadge from '../../Controls/SparkplugBadge';
import TopicTreeService from '../../../services/TopicTreeService';
import { decodeSparkplug, publishSparkplug, REBIRTH_METRIC } from '../../../services/Sparkplug';
import {
  parseSparkplugTopic,
  parseSparkplugValue,
  SPARKPLUG_SCALAR_TYPES,
  sparkplugTopic,
  type SparkplugScalarType,
} from '../../../../../shared/sparkplug';
import './SparkplugCommand.css';

interface Row {
  id: number;
  name: string;
  type: SparkplugScalarType;
  value: string;
}

const validId = (id: string) => id.length > 0 && !/[/+#]/.test(id);

/** Publishing > Sparkplug B command: NCMD to an edge node, or DCMD to one of its devices. */
export default function SparkplugCommand({
  connectionId,
  isConnected,
  selectedPath,
  showFeedback,
}: {
  connectionId?: string | null;
  isConnected: boolean;
  selectedPath: string | null;
  showFeedback?: (message: string, type?: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState({ group: '', edgeNode: '', device: '' });
  const [rows, setRows] = useState<Row[]>([{ id: 1, name: '', type: 'Boolean', value: 'true' }]);
  const nextId = useRef(2);
  // Metric names and types from the target's latest birth, offered while typing a name.
  const [known, setKnown] = useState<Record<string, SparkplugScalarType>>({});
  const [sending, setSending] = useState(false);
  const selected = parseSparkplugTopic(selectedPath ?? '');

  const fillFromSelected = () => {
    if (selected)
      setTarget({
        group: selected.group,
        edgeNode: selected.edgeNode,
        device: selected.device ?? '',
      });
  };

  useEffect(() => {
    const { group, edgeNode, device } = target;
    setKnown({});
    if (!open || !connectionId || !validId(group) || !validId(edgeNode)) return;
    const node = TopicTreeService.getTopicTree(connectionId)?.getNode(
      sparkplugTopic({
        group,
        edgeNode,
        messageType: device ? 'DBIRTH' : 'NBIRTH',
        device: device || undefined,
      }),
    );
    const message = node?.lastMessage;
    if (!node || !message) return;
    let cancelled = false;
    decodeSparkplug(message.payload, message.encoding ?? 'utf8', node.fullPath)
      .then((decoded) => {
        if (cancelled) return;
        const types: Record<string, SparkplugScalarType> = {};
        for (const [name, metric] of Object.entries(decoded.metrics))
          if (SPARKPLUG_SCALAR_TYPES.includes(metric.type as SparkplugScalarType))
            types[name] = metric.type as SparkplugScalarType;
        setKnown(types);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, connectionId, target]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const ids = [target.group, target.edgeNode, ...(target.device ? [target.device] : [])];
  const topic = ids.every(validId)
    ? sparkplugTopic({
        group: target.group,
        edgeNode: target.edgeNode,
        messageType: target.device ? 'DCMD' : 'NCMD',
        device: target.device || undefined,
      })
    : '';
  const parsed = rows.map((row) => ({ row, result: parseSparkplugValue(row.type, row.value) }));
  const problem = !topic
    ? 'Enter the group and edge node IDs, without /, + or #.'
    : rows.some((row) => !row.name.trim())
      ? 'Name every metric.'
      : '';

  const send = async () => {
    if (!connectionId || problem || parsed.some(({ result }) => 'error' in result)) return;
    setSending(true);
    try {
      const bytes = await publishSparkplug(connectionId, topic, {
        timestamp: Date.now(),
        metrics: parsed.map(({ row, result }) => ({
          name: row.name.trim(),
          type: row.type,
          value: (result as { value: boolean | number | string }).value,
        })),
      });
      showFeedback?.(`Command sent to ${topic} (${bytes} bytes).`, 'success');
    } catch (error) {
      showFeedback?.(`Command failed: ${(error as Error).message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <CheckToggle
      className="spb-command"
      checked={open}
      onChange={(checked) => {
        setOpen(checked);
        if (checked && !target.group && !target.edgeNode) fillFromSelected();
      }}
      label={
        <>
          <SparkplugBadge /> Sparkplug B command
        </>
      }
      hint="Sends NCMD to an edge node, or DCMD when a device is set. Values are encoded as Sparkplug B protobuf."
    >
      <div className="spb-command-target">
        <label>
          Group
          <input
            className="form-input"
            value={target.group}
            onChange={(event) => setTarget({ ...target, group: event.target.value })}
            placeholder="Plant"
          />
        </label>
        <label>
          Edge node
          <input
            className="form-input"
            value={target.edgeNode}
            onChange={(event) => setTarget({ ...target, edgeNode: event.target.value })}
            placeholder="Edge1"
          />
        </label>
        <label>
          Device
          <input
            className="form-input"
            value={target.device}
            onChange={(event) => setTarget({ ...target, device: event.target.value })}
            placeholder="Optional"
          />
        </label>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={fillFromSelected}
          disabled={!selected}
          title={selected ? `Use ${selectedPath}` : 'Select a Sparkplug topic first'}
        >
          <i className="fas fa-download" /> Selected topic
        </button>
      </div>
      <p className="spb-command-topic">{topic || 'spBv1.0/…/NCMD/…'}</p>

      <datalist id={listId}>
        {Object.keys(known).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="spb-command-metrics">
        {parsed.map(({ row, result }) => (
          <div className="spb-command-metric" key={row.id}>
            <input
              className="form-input"
              aria-label="Metric name"
              list={listId}
              value={row.name}
              placeholder="Metric name"
              onChange={(event) => {
                const name = event.target.value;
                update(row.id, { name, ...(known[name] && { type: known[name] }) });
              }}
            />
            <select
              className="form-select"
              aria-label="Metric type"
              value={row.type}
              onChange={(event) =>
                update(row.id, {
                  type: event.target.value as SparkplugScalarType,
                  ...(event.target.value === 'Boolean' && { value: 'true' }),
                })
              }
            >
              {SPARKPLUG_SCALAR_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            {row.type === 'Boolean' ? (
              <select
                className="form-select"
                aria-label="Metric value"
                value={row.value}
                onChange={(event) => update(row.id, { value: event.target.value })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                className="form-input"
                aria-label="Metric value"
                aria-invalid={'error' in result}
                title={'error' in result ? result.error : undefined}
                value={row.value}
                placeholder="Value"
                onChange={(event) => update(row.id, { value: event.target.value })}
              />
            )}
            <button
              type="button"
              className="spb-command-remove"
              aria-label="Remove metric"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((item) => item.id !== row.id))}
            >
              ×
            </button>
            {'error' in result && <span className="spb-command-error">{result.error}</span>}
          </div>
        ))}
      </div>

      <div className="spb-command-actions">
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() =>
            setRows([...rows, { id: nextId.current++, name: '', type: 'Boolean', value: 'true' }])
          }
        >
          <i className="fas fa-plus" /> Metric
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          title="Node Control/Rebirth = true, sent to the edge node"
          onClick={() => {
            setTarget({ ...target, device: '' });
            setRows([
              { id: nextId.current++, name: REBIRTH_METRIC, type: 'Boolean', value: 'true' },
            ]);
          }}
        >
          <i className="fas fa-redo" /> Rebirth
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={send}
          disabled={
            sending ||
            !connectionId ||
            !isConnected ||
            Boolean(problem) ||
            parsed.some(({ result }) => 'error' in result)
          }
          title={problem || (!isConnected ? 'Connect first' : `Publish to ${topic}`)}
        >
          <i className="fas fa-paper-plane" /> Send command
        </button>
      </div>
    </CheckToggle>
  );
}
