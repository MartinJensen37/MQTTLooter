import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import StableScrollViewport from '../StableScrollViewport';
import TopicTreeNode from './TopicTreeNode';
import HistoryControls from './HistoryControls';
import TrafficStatus from './TrafficStatus';
import './TopicTree.css';

function TopicTreeWorkspace({ connectionId, selectedPath, onTopicSelect, topicTreeService }) {
  const [nodes, setNodes] = useState([]);
  const [search, setSearch] = useState('');
  const searchRef = useRef('');
  searchRef.current = search;
  const [statistics, setStatistics] = useState(null);
  const [historySettings, setHistorySettings] = useState(() =>
    topicTreeService.getHistorySettings(),
  );
  const [isLoading, setIsLoading] = useState(true);

  const scrollRef = useRef(null);
  const pendingRaf = useRef(null);

  const loadNodes = useCallback(() => {
    try {
      setNodes(topicTreeService.getTopicTreeNodes(connectionId, false, searchRef.current));
      setStatistics(topicTreeService.getTopicTreeStatistics(connectionId));
      setHistorySettings(topicTreeService.getHistorySettings());
      setIsLoading(false);
    } catch (err) {
      console.error('Error loading topic tree nodes:', err);
      setIsLoading(false);
    }
  }, [connectionId, topicTreeService]);

  const scheduleLoad = useCallback(() => {
    if (pendingRaf.current) return;
    pendingRaf.current = requestAnimationFrame(() => {
      pendingRaf.current = null;
      loadNodes();
    });
  }, [loadNodes]);

  useEffect(() => {
    if (!connectionId || !topicTreeService) return;
    setIsLoading(true);
    loadNodes();

    const handleTreeUpdated = (data) => {
      if (data.connectionId === connectionId) scheduleLoad();
    };
    const handleNodeToggled = (data) => {
      if (data.connectionId === connectionId) scheduleLoad();
    };
    const handleTreeExpanded = (data) => {
      if (data.connectionId === connectionId) scheduleLoad();
    };

    const handleTreeCleared = (data) => {
      if (data.connectionId !== connectionId) return;
      setNodes([]);
      setStatistics(null);
    };

    const handleTreeRemoved = (data) => {
      if (data.connectionId !== connectionId) return;
      setNodes([]);
      setStatistics(null);
      setIsLoading(false);
    };

    const handleRatesUpdated = (data) => {
      if (data.trees && data.trees[connectionId]) {
        setStatistics(data.trees[connectionId]);
        scheduleLoad();
      }
    };

    topicTreeService.on('historySettingsChanged', scheduleLoad);
    topicTreeService.on('treeUpdated', handleTreeUpdated);
    topicTreeService.on('nodeToggled', handleNodeToggled);
    topicTreeService.on('treeExpanded', handleTreeExpanded);
    topicTreeService.on('treeCleared', handleTreeCleared);
    topicTreeService.on('treeRemoved', handleTreeRemoved);
    topicTreeService.on('ratesUpdated', handleRatesUpdated);

    return () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      topicTreeService.off('historySettingsChanged', scheduleLoad);
      topicTreeService.off('treeUpdated', handleTreeUpdated);
      topicTreeService.off('nodeToggled', handleNodeToggled);
      topicTreeService.off('treeExpanded', handleTreeExpanded);
      topicTreeService.off('treeCleared', handleTreeCleared);
      topicTreeService.off('treeRemoved', handleTreeRemoved);
      topicTreeService.off('ratesUpdated', handleRatesUpdated);
    };
  }, [connectionId, topicTreeService, loadNodes, scheduleLoad]);

  const handleNodeClick = useCallback(
    (node) => {
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
        if (onTopicSelect) onTopicSelect(node.fullPath, node);
      }
    },
    [connectionId, topicTreeService, onTopicSelect, selectedPath],
  );

  const handleExpandAll = useCallback(
    () => topicTreeService.expandTopicTreeToDepth(connectionId, Infinity),
    [connectionId, topicTreeService],
  );
  const handleCollapseAll = useCallback(
    () => topicTreeService.expandTopicTreeToDepth(connectionId, 0),
    [connectionId, topicTreeService],
  );
  const handleClearTree = useCallback(
    () => topicTreeService.clearTopicTree(connectionId),
    [connectionId, topicTreeService],
  );

  // Virtualize: only render visible topic rows (massive DOM savings)
  const rowVirtualizer = useVirtualizer({
    count: nodes.length,
    getItemKey: (index) => nodes[index].fullPath,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 15,
  });

  const historyNotice = (statistics?.discardedMessages > 0 || statistics?.evictedTopics > 0) && (
    <p role="status" className="history-limit-notice">
      History limit: {statistics.discardedMessages} messages discarded; {statistics.evictedTopics}{' '}
      topics evicted. Retained history budget: {(statistics.retainedBytes / 1048576).toFixed(1)} /{' '}
      {(statistics.limits.maxBytes / 1048576).toFixed(0)} MiB per connection.
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
            className="form-input"
            aria-label="Search topics"
            placeholder="Search topic paths..."
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
          {search && (
            <button
              className="btn btn-sm btn-secondary"
              aria-label="Clear topic search"
              onClick={() => {
                searchRef.current = '';
                setSearch('');
                loadNodes();
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div className="topic-search-status" role="status">
          {search
            ? `${nodes.filter((node) => node.searchMatch).length} matches / includes collapsed branches`
            : 'Topics stay in first-seen order'}
        </div>
        <HistoryControls
          connectionId={connectionId}
          selectedPath={selectedPath}
          statistics={statistics}
          settings={historySettings}
          service={topicTreeService}
          onSelect={onTopicSelect}
          onChange={loadNodes}
        />
        <TrafficStatus connectionId={connectionId} />
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
                />
              </div>
            );
          })}
        </div>
      </StableScrollViewport>
    </div>
  );
}

function TopicTreeComponent(props) {
  return <TopicTreeWorkspace key={props.connectionId ?? 'none'} {...props} />;
}
export default React.memo(TopicTreeComponent);
