import React, { useState, useEffect, useCallback, useRef } from 'react';
import TopicTreeNode from './TopicTreeNode';
import './TopicTree.css';

function TopicTreeComponent({ connectionId, onTopicSelect, topicTreeService }) {
  const [nodes, setNodes] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // RAF gate: batch all tree-update events into one render per frame
  const pendingRaf = useRef(null);

  const loadNodes = useCallback(() => {
    try {
      setNodes(topicTreeService.getTopicTreeNodes(connectionId, false));
      setStatistics(topicTreeService.getTopicTreeStatistics(connectionId));
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

    const handleTreeUpdated  = (data) => { if (data.connectionId === connectionId) scheduleLoad(); };
    const handleNodeToggled  = (data) => { if (data.connectionId === connectionId) scheduleLoad(); };
    const handleTreeExpanded = (data) => { if (data.connectionId === connectionId) scheduleLoad(); };

    const handleTreeCleared  = (data) => {
      if (data.connectionId !== connectionId) return;
      setNodes([]);
      setStatistics(null);
      setSelectedNode(null);
    };

    const handleTreeRemoved  = (data) => {
      if (data.connectionId !== connectionId) return;
      setNodes([]);
      setStatistics(null);
      setSelectedNode(null);
      setIsLoading(false);
    };

    const handleRatesUpdated = (data) => {
      if (data.trees && data.trees[connectionId]) {
        setStatistics(data.trees[connectionId]);
      }
    };

    topicTreeService.on('treeUpdated',  handleTreeUpdated);
    topicTreeService.on('nodeToggled',  handleNodeToggled);
    topicTreeService.on('treeExpanded', handleTreeExpanded);
    topicTreeService.on('treeCleared',  handleTreeCleared);
    topicTreeService.on('treeRemoved',  handleTreeRemoved);
    topicTreeService.on('ratesUpdated', handleRatesUpdated);

    return () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      topicTreeService.off('treeUpdated',  handleTreeUpdated);
      topicTreeService.off('nodeToggled',  handleNodeToggled);
      topicTreeService.off('treeExpanded', handleTreeExpanded);
      topicTreeService.off('treeCleared',  handleTreeCleared);
      topicTreeService.off('treeRemoved',  handleTreeRemoved);
      topicTreeService.off('ratesUpdated', handleRatesUpdated);
    };
  }, [connectionId, topicTreeService, loadNodes, scheduleLoad]);

  const handleNodeClick = useCallback((node) => {
    const hasDirectMessages = node.hasDirectMessages || node.isLeaf;
    const hasMessages = node.messageCount > 0;

    if (node.hasChildren) {
      topicTreeService.toggleTopicNode(connectionId, node.fullPath);
    }

    if (hasMessages && (hasDirectMessages || node.hasChildren)) {
      setSelectedNode(node.fullPath);
      if (onTopicSelect) onTopicSelect(node.fullPath, node);
    }
  }, [connectionId, topicTreeService, onTopicSelect]);

  const handleExpandAll  = useCallback(() => topicTreeService.expandTopicTreeToDepth(connectionId, 10), [connectionId, topicTreeService]);
  const handleCollapseAll = useCallback(() => topicTreeService.expandTopicTreeToDepth(connectionId, 0),  [connectionId, topicTreeService]);
  const handleClearTree  = useCallback(() => topicTreeService.clearTopicTree(connectionId), [connectionId, topicTreeService]);

  if (isLoading) {
    return (
      <div className="topic-tree-container">
        <div className="topic-tree-header">
          <h3>Topic Tree</h3>
          <div className="topic-tree-stats">Loading...</div>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="topic-tree-container">
        <div className="topic-tree-header">
          <h3>Topic Tree</h3>
          <div className="topic-tree-stats">No topics yet — waiting for messages...</div>
        </div>
        <div className="topic-tree-empty">
          <p>Connect to an MQTT broker and start receiving messages to see the topic tree.</p>
          <p>Topics will appear here as messages are received.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="topic-tree-container">
      <div className="topic-tree-header">
        <div className="topic-tree-header-top">
          <h3>Topic Tree</h3>
          <div className="topic-tree-controls">
            <button onClick={handleExpandAll}  className="tree-control-btn expand-btn"   title="Expand all topics"><i className="fas fa-expand-arrows-alt"></i></button>
            <button onClick={handleCollapseAll} className="tree-control-btn collapse-btn" title="Collapse all topics"><i className="fas fa-compress-arrows-alt"></i></button>
            <button onClick={handleClearTree}  className="tree-control-btn clear-btn"    title="Clear topic tree"><i className="fas fa-trash"></i></button>
          </div>
        </div>
        {statistics && (
          <div className="topic-tree-stats">
            <span className="stat-item"><i className="fas fa-sitemap"></i> {statistics.totalNodes} topics</span>
            <span className="stat-item"><i className="fas fa-envelope"></i> {statistics.totalMessages} messages</span>
            <span className="stat-item"><i className="fas fa-tachometer-alt"></i> {statistics.totalRate?.toFixed(1)} msg/s</span>
          </div>
        )}
      </div>

      <div className="topic-tree-content">
        {nodes.map((node) => (
          <TopicTreeNode
            key={node.fullPath}
            node={node}
            onClick={handleNodeClick}
            isSelected={selectedNode === node.fullPath}
          />
        ))}
      </div>
    </div>
  );
}

export default React.memo(TopicTreeComponent);
