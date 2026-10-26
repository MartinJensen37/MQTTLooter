import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { SplitPane, Pane } from 'react-split-pane';
import MQTTService from '../../services/MQTTService';
import TopicTreeService from '../../services/TopicTreeService';
import { ConnectionNotices } from '../../services/ConnectionNotices';
import ConnectionSidebar from '../ConnectionSidebar/ConnectionSidebar';
import TopicTreeComponent from '../TopicTree/TopicTreeComponent';
import MessagePanel from '../MessagePanel/MessageWorkspace';
import RecordingPanel from '../RecordingPanel/RecordingPanel';
import SettingsDialog from './SettingsDialog';
import AboutDialog from './AboutDialog';
import { useAppearance } from '../../hooks/useAppearance';
import { useSettings } from '../../services/Settings';
import { useConnections } from '../../hooks/useConnections';
import { useMessages } from '../../hooks/useMessages';
import { useUIState, type PanePin } from '../../hooks/useUIState';
import type { PayloadEncoding } from '../../../../shared/payload';
import { NotificationStack, useNotifications } from './Notifications';
import MainTabs, { type Tab } from './MainTabs';
import './App.css';

interface SelectedTopic {
  topicPath: string;
  connectionId: string;
}
/** A message from Publishing, Recording playback or Simulation. */
export interface OutgoingMessage {
  topic: string;
  payload: string;
  encoding?: PayloadEncoding;
  qos?: 0 | 1 | 2;
  retain?: boolean;
  properties?: Record<string, unknown>;
}
type ConnectionEvent = { id: string };

// Loaded when first shown; afterwards they stay mounted like the other panels. Recording stays
// eager so captures that main stops after a reload are still reported.
const PublishingPanel = lazy(() => import('../PublishingPanel/PublishingPanel'));
const SimulationPanel = lazy(() => import('../SimulationPanel/SimulationPanel'));
const panelLoading = <p className="panel-loading">Loading…</p>;

async function publishTo(connectionId: string | null, messageData: OutgoingMessage) {
  if (!connectionId) throw new Error('No connection selected');
  if (!MQTTService.isConnected(connectionId)) throw new Error('Selected connection is not active');
  await MQTTService.publish(connectionId, {
    topic: messageData.topic,
    message: messageData.payload,
    encoding: messageData.encoding,
    qos: messageData.qos,
    retain: messageData.retain,
    properties: messageData.properties,
  });
}

function App() {
  const [selectedTopic, setSelectedTopic] = useState<SelectedTopic | null>(null);
  // Tools > Settings in the app menu.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => window.electronAPI?.app?.onOpenSettings(() => setSettingsOpen(true)), []);
  // Help > About in the app menu.
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => window.electronAPI?.app?.onOpenAbout?.(() => setAboutOpen(true)), []);
  useAppearance();
  // Help > Check for updates offers stable releases, or betas too, as chosen in Settings.
  const { updateChannel } = useSettings();
  useEffect(() => {
    void window.electronAPI?.app?.setUpdateChannel?.(updateChannel);
  }, [updateChannel]);
  const mainPanelsRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setPanelWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(mainPanelsRef.current!);
    return () => observer.disconnect();
  }, []);
  // Clamp the rendered width without overwriting the user's preferred split on window resize.
  const maxTopicWidth = Math.max(50, panelWidth - 361);

  const { notifications, showFeedback, remove: removeNotification } = useNotifications();

  // ── Custom hooks ─────────────────────────────────────────────────────────
  const {
    connections,
    setConnections,
    selectedConnection,
    setLastSelectedTopics,
    activeConnections,
    handleConnectionCreate,
    handleConnectionSelect,
    handleConnectionToggle,
    handleConnectionDelete,
  } = useConnections(showFeedback, selectedTopic, (topic) =>
    setSelectedTopic(topic as SelectedTopic | null),
  );

  const { connectionMessages, handleClearMessages, liveSelectedTopic } = useMessages(
    selectedConnection,
    selectedTopic,
    showFeedback,
  );

  const {
    sidebarCollapsed,
    sidebarWidth,
    resizeSidebar,
    topicTreeWidth,
    setTopicTreeWidth,
    showTopicTree,
    topicTreeReady,
    setTopicTreeReady,
    activeTab,
    setActiveTab,
    splitTab,
    setSplitTab,
    splitRatio,
    setSplitRatio,
    panePin,
    setPanePin,
    handleToggleSidebarCollapse,
  } = useUIState(selectedConnection);
  const pinned = useMessages(
    panePin?.connectionId ?? null,
    panePin?.topic ?? null,
    showFeedback,
    'pane',
  );
  // A deleted connection cannot stay pinned.
  useEffect(() => {
    if (panePin && !connections.some((connection) => connection.id === panePin.connectionId))
      setPanePin(null);
  }, [connections, panePin, setPanePin]);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  // Keyboard focus on a tab follows F-key switches to the newly active tab.
  useEffect(() => {
    if (document.activeElement?.classList.contains('tab-btn'))
      document.querySelector<HTMLElement>('.main-tabs .tab-btn.active')?.focus();
  }, [activeTab]);
  // Below 560 px of content width the panes stack instead of sitting side by side.
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const element = tabContainerRef.current;
    if (!splitTab || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < 560));
    observer.observe(element);
    return () => observer.disconnect();
  }, [splitTab, selectedConnection]);
  // Split view places two tabs side by side with CSS, so no panel is remounted or duplicated.
  const placement = (tab: Tab) =>
    tab === activeTab ? 'active' : tab === splitTab ? 'secondary' : 'hidden';
  const visible = (tab: Tab) => tab === activeTab || tab === splitTab;
  // Tabs shown at least once; only grows, so recording it during render is harmless.
  const opened = useRef(new Set<Tab>());
  opened.current.add(activeTab);
  if (splitTab) opened.current.add(splitTab);
  const startSplitDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    const rect = tabContainerRef.current!.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) =>
      setSplitRatio(
        stacked
          ? (moveEvent.clientY - rect.top) / rect.height
          : (moveEvent.clientX - rect.left) / rect.width,
      );
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  // ── MQTT event listeners ─────────────────────────────────────────────────
  const notices = useRef(new ConnectionNotices());
  useEffect(() => {
    setTopicTreeReady(TopicTreeService.isReady());
    const handleConnected = (data: ConnectionEvent) => {
      setConnections((prev) =>
        prev.map((c) => (c.id === data.id ? { ...c, status: 'connected', isConnected: true } : c)),
      );
      const kind = notices.current.connected(data.id);
      showFeedback(
        kind === 'reconnected' ? 'Reconnected to broker' : 'Connected to broker',
        'success',
      );
    };
    const handleDisconnected = (data: ConnectionEvent) => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === data.id ? { ...c, status: 'disconnected', isConnected: false } : c,
        ),
      );
    };
    const handleReconnecting = (data: ConnectionEvent) => {
      notices.current.reconnecting(data.id);
      setConnections((prev) =>
        prev.map((c) =>
          c.id === data.id ? { ...c, status: 'reconnecting', isConnected: false } : c,
        ),
      );
    };
    const handleError = (data: { id: string; error: string }) => {
      const message = data.error || 'Unknown error';
      if (notices.current.error(data.id, message)) showFeedback(`MQTT error: ${message}`, 'error');
    };
    const handleTreeCleared = ({ connectionId }: { connectionId: string }) => {
      setSelectedTopic((previous) => (previous?.connectionId === connectionId ? null : previous));
      setPanePin((previous: PanePin | null) =>
        previous?.connectionId === connectionId ? { ...previous, topic: null } : previous,
      );
      setLastSelectedTopics((previous) => {
        const next = { ...previous };
        delete next[connectionId];
        return next;
      });
    };
    MQTTService.onAny('connected', handleConnected);
    MQTTService.onAny('disconnected', handleDisconnected);
    MQTTService.onAny('reconnecting', handleReconnecting);
    MQTTService.onAny('error', handleError);
    TopicTreeService.on('treeCleared', handleTreeCleared);
    return () => {
      MQTTService.off('*', 'connected', handleConnected);
      MQTTService.off('*', 'disconnected', handleDisconnected);
      MQTTService.off('*', 'reconnecting', handleReconnecting);
      MQTTService.off('*', 'error', handleError);
      TopicTreeService.off('treeCleared', handleTreeCleared);
    };
  }, [setConnections, setTopicTreeReady, setLastSelectedTopics, setPanePin, showFeedback]);

  // ── Small handlers ───────────────────────────────────────────────────────
  const handleTopicSelect = (topicPath: string) => {
    if (!selectedConnection) return;
    TopicTreeService.selectTopic(selectedConnection, topicPath);
    const topic = { topicPath, connectionId: selectedConnection };
    setSelectedTopic(topic);
    setLastSelectedTopics((prev) => ({ ...prev, [selectedConnection]: topic }));
  };

  const handlePublishMessage = useCallback(
    (messageData: OutgoingMessage) => publishTo(selectedConnection, messageData),
    [selectedConnection],
  );
  const pinnedConnection = panePin?.connectionId ?? null;
  const handlePinnedPublish = useCallback(
    (messageData: OutgoingMessage) => publishTo(pinnedConnection, messageData),
    [pinnedConnection],
  );

  const connectionView = (id: string | null) => connections.find((c) => c.id === id);
  const getConnectionName = (id = selectedConnection) =>
    connectionView(id)?.config?.name || 'Unknown Connection';

  // ── Render helpers ───────────────────────────────────────────────────────
  // Every panel follows the sidebar, except the one in a pinned second pane.
  const paneFor = (tab: Tab) => {
    if (!panePin || tab !== splitTab)
      return {
        connectionId: selectedConnection,
        messages: connectionMessages,
        selectedTopic: liveSelectedTopic,
        onClearMessages: handleClearMessages,
        onPublishMessage: handlePublishMessage,
      };
    return {
      connectionId: panePin.connectionId,
      messages: pinned.connectionMessages,
      selectedTopic: pinned.liveSelectedTopic,
      onClearMessages: pinned.handleClearMessages,
      onPublishMessage: handlePinnedPublish,
    };
  };
  const connectedPane = (pane: { connectionId: string | null }) =>
    connectionView(pane.connectionId)?.isConnected || false;
  const pinLabel = (tab: Tab) =>
    panePin && tab === splitTab ? (
      <div className="pane-pin">
        <i className="fas fa-thumbtack" aria-hidden="true"></i>
        <span>
          Pinned to <strong>{getConnectionName(panePin.connectionId)}</strong>
          {panePin.topic && <code>{panePin.topic.topicPath}</code>}
        </span>
      </div>
    ) : null;
  const logging = paneFor('logging');
  const publishing = paneFor('publishing');
  const recording = paneFor('recording');
  const simulation = paneFor('simulation');

  const renderTabContent = () => (
    <div
      ref={tabContainerRef}
      className={`tab-content-container${splitTab ? ' split' : ''}${splitTab && stacked ? ' stacked' : ''}`}
      style={splitTab ? ({ '--split': `${splitRatio * 100}%` } as CSSProperties) : undefined}
    >
      <div className={`tab-content ${placement('logging')}`}>
        {pinLabel('logging')}
        <MessagePanel
          active={visible('logging')}
          connectionId={logging.connectionId}
          messages={logging.messages}
          selectedTopic={logging.selectedTopic}
          connectionName={getConnectionName(logging.connectionId)}
          onClearMessages={logging.onClearMessages}
          isConnected={connectedPane(logging)}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${placement('publishing')}`}>
        {pinLabel('publishing')}
        {opened.current.has('publishing') && (
          <Suspense fallback={panelLoading}>
            <PublishingPanel
              protocolVersion={
                connectedPane(publishing) && publishing.connectionId
                  ? MQTTService.getProtocolVersion(publishing.connectionId)
                  : (connectionView(publishing.connectionId)?.config?.protocolVersion ?? 4)
              }
              key={publishing.connectionId}
              connectionId={publishing.connectionId}
              onPublishMessage={publishing.onPublishMessage}
              isConnected={connectedPane(publishing)}
              selectedTopic={publishing.selectedTopic}
              showFeedback={showFeedback}
            />
          </Suspense>
        )}
      </div>
      <div className={`tab-content ${placement('recording')}`}>
        {pinLabel('recording')}
        <RecordingPanel
          connectionName={getConnectionName(recording.connectionId)}
          selectedTopic={recording.selectedTopic}
          onPublishMessage={recording.onPublishMessage}
          isConnected={connectedPane(recording)}
          activeConnectionId={recording.connectionId}
          showFeedback={showFeedback}
        />
      </div>
      <div className={`tab-content ${placement('simulation')}`}>
        {pinLabel('simulation')}
        {opened.current.has('simulation') && (
          <Suspense fallback={panelLoading}>
            <SimulationPanel
              connectionId={simulation.connectionId}
              connections={connections}
              publish={publishTo}
              selectedTopic={simulation.selectedTopic}
              showFeedback={showFeedback}
            />
          </Suspense>
        )}
      </div>
      {splitTab && (
        <div
          className="split-divider"
          role="separator"
          aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-label="Resize split view"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          onPointerDown={startSplitDrag}
          onKeyDown={(event) => {
            if (event.key === (stacked ? 'ArrowUp' : 'ArrowLeft')) setSplitRatio(splitRatio - 0.05);
            if (event.key === (stacked ? 'ArrowDown' : 'ArrowRight'))
              setSplitRatio(splitRatio + 0.05);
          }}
        />
      )}
    </div>
  );

  const renderMainContent = () => {
    if (!selectedConnection) {
      return (
        <div className="no-connection-selected">
          <div className="no-connection-icon">
            <i className="fas fa-plug"></i>
          </div>
          <h2>No Connection Selected</h2>
          <p>Select an active connection from the sidebar to view messages and topics.</p>
          <p className="hint">Create a new connection using the + button in the sidebar.</p>
        </div>
      );
    }
    if (!showTopicTree || !topicTreeReady) return renderTabContent();
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SplitPane
          direction="horizontal"
          dividerSize={9}
          dividerStyle={{ width: '9px' }}
          onResize={(sizes) => setTopicTreeWidth(sizes[0])}
          dividerClassName="resizer-divider"
        >
          <Pane
            className="topic-browser-pane"
            minSize={50}
            maxSize={maxTopicWidth}
            size={Math.min(topicTreeWidth, maxTopicWidth)}
          >
            <div className="topic-tree-panel">
              <TopicTreeComponent
                connectionId={selectedConnection}
                selectedPath={selectedTopic?.topicPath ?? null}
                onTopicSelect={handleTopicSelect}
                topicTreeService={TopicTreeService}
              />
            </div>
          </Pane>
          <Pane minSize={Math.max(0, Math.min(360, panelWidth - 51))}>{renderTabContent()}</Pane>
        </SplitPane>
      </div>
    );
  };

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {aboutOpen && <AboutDialog connections={connections} onClose={() => setAboutOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          connections={connections.map((connection) => ({
            id: connection.id,
            name: connection.config?.name || 'Unnamed connection',
          }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <NotificationStack notifications={notifications} onClose={removeNotification} />

      <div
        className="app-layout"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <ConnectionSidebar
          connections={connections}
          activeConnections={activeConnections}
          onConnectionSelect={handleConnectionSelect}
          onConnectionCreate={handleConnectionCreate}
          onConnectionDelete={handleConnectionDelete}
          onConnectionToggle={handleConnectionToggle}
          selectedConnectionId={selectedConnection}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebarCollapse}
        />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize connection list"
          aria-valuemin={0}
          aria-valuemax={420}
          aria-valuenow={sidebarCollapsed ? 0 : sidebarWidth}
          tabIndex={0}
          title="Drag to resize; drag fully in to collapse"
          onPointerDown={(event) => {
            event.preventDefault();
            const left = event.currentTarget.parentElement!.getBoundingClientRect().left;
            const move = (moveEvent: PointerEvent) => resizeSidebar(moveEvent.clientX - left);
            const stop = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', stop);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', stop);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && !sidebarCollapsed) resizeSidebar(sidebarWidth - 20);
            if (event.key === 'ArrowRight')
              resizeSidebar(sidebarCollapsed ? sidebarWidth : sidebarWidth + 20);
          }}
        />

        <div className="main-content">
          <div className="main-header">
            <div className="header-left">
              <h2>{selectedConnection ? getConnectionName() : 'MQTTLooter'}</h2>
              {selectedConnection && activeConnections.length > 1 && (
                <div className="connection-info">
                  <span className="multi-connection-indicator">
                    {activeConnections.length} active connections
                  </span>
                </div>
              )}
            </div>
            {selectedConnection && (
              <MainTabs
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                splitTab={splitTab}
                onSplitTabChange={setSplitTab}
                pinned={Boolean(panePin)}
                onTogglePin={() =>
                  setPanePin(
                    panePin
                      ? null
                      : {
                          connectionId: selectedConnection,
                          topic:
                            selectedTopic?.connectionId === selectedConnection
                              ? selectedTopic
                              : null,
                        },
                  )
                }
              />
            )}
          </div>

          <div className="main-panels" ref={mainPanelsRef}>
            {renderMainContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
