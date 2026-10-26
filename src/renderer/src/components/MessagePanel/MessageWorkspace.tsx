import { useEffect, useState } from 'react';
import MessagePanel from './MessagePanel';
import IncomingPlot from './IncomingPlot';
import DecoderSettings from './DecoderSettings';
import { useDecoders, useTopicDecoders } from '../../services/DecoderRegistry';
import { settings as settingsStore, useSettings } from '../../services/Settings';
import type { HistoryStatus } from '../../../../shared/history';
import { matchDecoder } from '../../../../shared/decoders';
import TopicTreeService from '../../services/TopicTreeService';
import { useTopicMessages } from '../../hooks/useTopicMessages';
import { useTopicSearch, type SearchMode } from '../../hooks/useTopicSearch';
import { clockTime } from '../../utils/time';
import './MessageWorkspace.css';

export default function MessageWorkspace(props: any) {
  return <Workspace key={props.connectionId ?? 'none'} {...props} />;
}

function Workspace(props: any) {
  const [plotOpen, setPlotOpen] = useState(false);
  const [status, setStatus] = useState<HistoryStatus>();
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [mode, setMode] = useState<SearchMode>('text');
  const [decodersOpen, setDecodersOpen] = useState(false);
  const { decoders } = useDecoders();
  const topicDecoders = useTopicDecoders();
  const settings = useSettings();
  const topic: string | undefined = props.selectedTopic?.topicPath;
  const connectionId = props.connectionId;
  const active = props.active !== false;
  const decodable = topic !== undefined && Boolean(matchDecoder(topicDecoders, topic));

  const view = useTopicMessages(
    connectionId,
    topic,
    props.messages,
    settings.messagesShown,
    active && !plotOpen,
  );
  const searchMode = mode === 'decoded' && !decodable ? 'text' : mode;
  const search = useTopicSearch(
    connectionId,
    topic,
    plotOpen ? '' : term,
    searchMode,
    settings.messagesShown,
    active,
  );
  const searching = Boolean(term) && !plotOpen;

  useEffect(() => {
    setError('');
  }, [topic]);
  useEffect(() => {
    if (!connectionId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await window.electronAPI.history.status();
        if (!disposed && result.success) setStatus(result.data);
      } catch {
        /* Main may be shutting down. */
      } finally {
        if (!disposed) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [connectionId, refresh]);

  const exportAll = async (format: 'json' | 'csv') => {
    if (!connectionId || topic === undefined) return;
    try {
      const name = props.connectionName ?? 'Unknown';
      const result =
        searching && search.query
          ? await window.electronAPI.history.exportSearch(search.query, format, name)
          : await window.electronAPI.history.export(connectionId, topic, format, name);
      if (!result.success) throw new Error(result.error ?? 'Export failed');
      if (result.data?.saved)
        props.showFeedback?.(
          `Exported ${result.data.count?.toLocaleString()} messages to ${result.data.path}`,
          'success',
        );
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const clear = async () => {
    if (!connectionId || topic === undefined) return;
    const result = await window.electronAPI.history.clear(connectionId, topic);
    if (!result.success) {
      setError(result.error ?? 'Could not clear history');
      return;
    }
    TopicTreeService.clearTopicMessages(connectionId, topic);
    view.reset();
    setTerm('');
    props.showFeedback?.('Messages cleared for this topic.', 'success');
  };
  // Durable gap records cover earlier runs; this run's drops may not be written yet.
  const gap = status?.store?.gaps?.[connectionId];
  const missing = Math.max(
    gap?.dropped ?? 0,
    status?.delivery.connections[connectionId]?.dropped ?? 0,
  );
  const lastGap = gap?.last;

  const shown = searching ? search.matches : view.messages;
  const progress = searching
    ? [
        `${search.scanned.toLocaleString()} stored messages searched`,
        search.searching && 'searching…',
        search.skipped > 0 &&
          `${search.skipped.toLocaleString()} skipped (${searchMode === 'decoded' ? 'no matching decoder' : searchMode === 'text' ? 'binary or very large' : 'very large'})`,
      ]
    : [
        view.loading && 'loading older messages…',
        view.capped && 'older messages are in disk history; export to get them all',
      ];

  return (
    <div className="message-workspace">
      {decodersOpen && <DecoderSettings onClose={() => setDecodersOpen(false)} />}
      {status?.error && (
        <p role="alert" className="message-storage-notice">
          Disk capture stopped: {status.error}{' '}
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const result = await window.electronAPI.history.resume();
              if (!result.success) setError(result.error ?? 'Could not resume');
              setRefresh((value) => value + 1);
            }}
          >
            Resume capture
          </button>
        </p>
      )}
      {missing > 0 && (
        <p className="message-storage-notice">
          Disk history has gaps: {missing.toLocaleString()} messages were not stored
          {lastGap ? ` (latest ${clockTime(lastGap)})` : ''}.
        </p>
      )}
      <MessagePanel
        {...props}
        onPlotChange={setPlotOpen}
        plotContent={
          plotOpen && connectionId && topic !== undefined ? (
            <IncomingPlot
              active={props.active}
              key={`${connectionId}:${topic}`}
              connectionId={connectionId}
              topic={topic}
              connected={props.isConnected !== false}
            />
          ) : null
        }
        messages={shown}
        searching={searching}
        shownLimit={settings.messagesShown}
        onShownLimitChange={(messagesShown: typeof settings.messagesShown) =>
          settingsStore.set({ messagesShown })
        }
        search={{
          term,
          mode: searchMode,
          decodable,
          onTermChange: setTerm,
          onModeChange: setMode,
        }}
        progress={progress.filter(Boolean).join(' · ')}
        error={error || (searching ? search.error : view.error)}
        onDecoders={
          settings.protobufDecoders || decoders.length > 0
            ? { count: decoders.length, open: () => setDecodersOpen(true) }
            : undefined
        }
        onClearMessages={clear}
        onExportAll={exportAll}
        exportAllLabel={searching ? 'All matches as' : 'Full disk history as'}
      />
    </div>
  );
}
