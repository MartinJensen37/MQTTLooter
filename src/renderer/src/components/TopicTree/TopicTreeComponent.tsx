import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import StableScrollViewport from '../StableScrollViewport';
import TopicTreeNode from './TopicTreeNode';
import TrafficStatus from './TrafficStatus';
import { useSettings } from '../../services/Settings';
import type { TopicTreeService } from '../../services/TopicTreeService';
import type TopicTree from '../../services/models/TopicTree';
import type { FlattenedNode } from '../../services/models/TopicTree';
import './TopicTree.css';

type Statistics = ReturnType<TopicTree['getStatistics']>;
interface TreeEvent {
  connectionId: string;
}
interface TopicTreeProps {
  connectionId: string | null;
  selectedPath: string | null;
  onTopicSelect?: (path: string, node: FlattenedNode) => void;
  topicTreeService: TopicTreeService;
}

function TopicTreeWorkspace({
  connectionId,
  selectedPath,
  onTopicSelect,
  topicTreeService,
}: TopicTreeProps) {
  const [nodes, setNodes] = useState<FlattenedNode[]>([]);
  const { sparkplug } = useSettings();
  const [search, setSearch] = useState('');
  const searchRef = useRef('');
  searchRef.current = search;
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNodes = useCallback(() => {
    if (!connectionId) return;
    try {
      setNodes(topicTreeService.getTopicTreeNodes(connectionId, false, searchRef.current));
      setStatistics(topicTreeService.getTopicTreeStatistics(connectionId));
      setIsLoading(false);
    } catch (err) {
      console.error('Error loading topic tree nodes:', err);
      setIsLoading(false);
    }
  }, [connectionId, topicTreeService]);

  const scheduleLoad = useCallback(() => {
    // Data refresh must also run when Chromium suspends animation frames.
    if (pendingRefresh.current !== null) return;
    pendingRefresh.current = setTimeout(() => {
      pendingRefresh.current = null;
      loadNodes();
    }, 0);
  }, [loadNodes]);

  useEffect(() => {
    if (!connectionId || !topicTreeService) return;
    setIsLoading(true);
    loadNodes();

    const handleTreeChanged = (data: TreeEvent) => {
      if (data.connectionId === connectionId) scheduleLoad();
    };
    const handleTreeCleared = (data: TreeEvent) => {
      if (data.connectionId !== connectionId) return;
      setNodes([]);
      setStatistics(null);
    };
    const handleTreeRemoved = (data: TreeEvent) => {
      if (data.connectionId !== connectionId) return;
      setNodes([]);
      setStatistics(null);
      setIsLoading(false);
    };
    const handleRatesUpdated = (data: { trees?: Record<string, Statistics> }) => {
      if (data.trees && data.trees[connectionId]) {
        setStatistics(data.trees[connectionId]);
        scheduleLoad();
      }
    };

    topicTreeService.on('historySettingsChanged', scheduleLoad);
    topicTreeService.on('treeUpdated', handleTreeChanged);
    topicTreeService.on('nodeToggled', handleTreeChanged);
    topicTreeService.on('treeExpanded', handleTreeChanged);
    topicTreeService.on('treeCleared', handleTreeCleared);
    topicTreeService.on('treeRemoved', handleTreeRemoved);
    topicTreeService.on('ratesUpdated', handleRatesUpdated);

    return () => {
      if (pendingRefresh.current) {
        clearTimeout(pendingRefresh.current);
        pendingRefresh.current = null;
      }
      topicTreeService.off('historySettingsChanged', scheduleLoad);
      topicTreeService.off('treeUpdated', handleTreeChanged);
      topicTreeService.off('nodeToggled', handleTreeChanged);
      topicTreeService.off('treeExpanded', handleTreeChanged);
      topicTreeService.off('treeCleared', handleTreeCleared);
      topicTreeService.off('treeRemoved', handleTreeRemoved);
      topicTreeService.off('ratesUpdated', handleRatesUpdated);
    };
  }, [connectionId, topicTreeService, loadNodes, scheduleLoad]);

  const handleNodeClick = useCallback(
    (node: FlattenedNode) => {
      if (!connectionId) return;
      const hasDirectMessages = node.hasDirectMessages || node.isLeaf;
      const hasMessages = node.messageCount > 0;

      if (node.hasChildren && !searchRef.current) {
        topicTreeService.toggleTopicNode(connectionId, node.fullPath);
      }

      if (
        (hasMessages && (hasDirectMessages || node.hasChildren)) ||
        node.pinned ||
        selectedPath === node.fullPath
      ) {
        onTopicSelect?.(node.fullPath, node);
      }
    },
    [connectionId, topicTreeService, onTopicSelect, selectedPath],
  );

  const handleExpandAll = () =>
    connectionId && topicTreeService.expandTopicTreeToDepth(connectionId, Infinity);
  const handleCollapseAll = () =>
    connectionId && topicTreeService.expandTopicTreeToDepth(connectionId, 0);
  const handleClearTree = () => connectionId && topicTreeService.clearTopicTree(connectionId);

  // Virtualize: only render visible topic rows (massive DOM savings)
  const rowVirtualizer = useVirtualizer({
    count: nodes.length,
    getItemKey: (index) => nodes[index].fullPath,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 15,
  });

  const historyNotice = statistics &&
    (statistics.discardedMessages > 0 || statistics.evictedTopics > 0) && (
      <p role="status" className="history-limit-notice">
        {statistics.discardedMessages} messages expired; {statistics.evictedTopics} topics evicted.
      </p>
    );

  return (
    <div className="topic-tree-container">
      <div className="topic-tree-header">
        <div className="topic-tree-header-top">
          <h3>Topic Tree</h3>
          <div className="topic-tree-controls">
            <button
              disabled={!!search || !nodes.length}
              onClick={handleExpandAll}
              className="tree-control-btn expand-btn"
              title="Expand all topics"
            >
              <i className="fas fa-expand-arrows-alt"></i>
            </button>
            <button
              disabled={!!search || !nodes.length}
              onClick={handleCollapseAll}
              className="tree-control-btn collapse-btn"
              title="Collapse all topics"
            >
              <i className="fas fa-compress-arrows-alt"></i>
            </button>
            <button
              onClick={handleClearTree}
              className="tree-control-btn clear-btn"
              title="Clear topic tree"
            >
              <i className="fas fa-trash"></i>
            </button>
          </div>
        </div>
        {statistics && (
          <div className="topic-tree-stats">
            <span className="stat-item">
              <i className="fas fa-sitemap"></i> {statistics.totalNodes} topics
            </span>
            <span className="stat-item">
              <i className="fas fa-envelope"></i> {statistics.totalMessages} messages
            </span>
            <span className="stat-item">
              <i className="fas fa-tachometer-alt"></i> {statistics.totalRate?.toFixed(1)} msg/s
            </span>
          </div>
        )}
        <div className="topic-search">
          <input
            type="search"
            className="form-input search-input"
            aria-label="Search topics"
            placeholder="Search topics"
            value={search}
            onChange={(event) => {
              searchRef.current = event.target.value;
              setSearch(event.target.value);
              loadNodes();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                searchRef.current = '';
                setSearch('');
                loadNodes();
              }
            }}
          />
        </div>
        {search && (
          <div className="topic-search-status" role="status">
            {nodes.filter((node) => node.searchMatch).length} matches
          </div>
        )}
        {connectionId && <TrafficStatus connectionId={connectionId} />}
        {historyNotice}
      </div>

      <StableScrollViewport
        className="topic-tree-content"
        viewportRef={scrollRef}
        itemKeys={nodes.map((node) => node.fullPath)}
        rowHeight={38}
        viewKey={search}
      >
        {!nodes.length && (
          <div className="topic-tree-empty">
            {isLoading
              ? 'Loading topics...'
              : search
                ? 'No topics match your search.'
                : 'Waiting for messages. Topics will appear here as they arrive.'}
          </div>
        )}
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const node = nodes[virtualRow.index];
            return (
              <div
                key={node.fullPath}
                data-scroll-key={node.fullPath}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TopicTreeNode
                  node={node}
                  onClick={handleNodeClick}
                  isSelected={selectedPath === node.fullPath}
                  sparkplug={sparkplug}
                />
              </div>
            );
          })}
        </div>
      </StableScrollViewport>
    </div>
  );
}

function TopicTreeComponent(props: TopicTreeProps) {
  return <TopicTreeWorkspace key={props.connectionId ?? 'none'} {...props} />;
}
export default memo(TopicTreeComponent);
