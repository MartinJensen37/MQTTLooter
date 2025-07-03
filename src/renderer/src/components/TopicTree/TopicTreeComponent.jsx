import React, { useState, useEffect } from 'react';
import TopicTreeNode from './TopicTreeNode';
import './TopicTree.css';

function TopicTreeComponent({ connectionId, onTopicSelect, topicTreeService }) {
  const [nodes, setNodes] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!connectionId || !topicTreeService) return;

    setIsLoading(true);

    // Load initial nodes from topic tree service
    const loadNodes = () => {
      try {
        const treeNodes = topicTreeService.getTopicTreeNodes(connectionId, false);
        setNodes(treeNodes);
        
        const stats = topicTreeService.getTopicTreeStatistics(connectionId);
        setStatistics(stats);
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading topic tree nodes:', error);
        setIsLoading(false);
      }
    };

    // Initial load
    loadNodes();

    // Set up event listeners
    const handleTreeUpdated = (data) => {
      if (data.connectionId === connectionId) {
        loadNodes();
      }
    };

    const handleNodeToggled = (data) => {
      if (data.connectionId === connectionId) {
        loadNodes();
      }
    };

    const handleTreeExpanded = (data) => {
      if (data.connectionId === connectionId) {
        loadNodes();
      }
    };

    const handleTreeCleared = (data) => {
      if (data.connectionId === connectionId) {
        setNodes([]);
        setStatistics(null);
        setSelectedNode(null);
      }
    };

    const handleTreeRemoved = (data) => {
      if (data.connectionId === connectionId) {
        setNodes([]);
        setStatistics(null);
        setSelectedNode(null);
        setIsLoading(false);
      }
    };

    const handleRatesUpdated = (data) => {
      if (data.trees && data.trees[connectionId]) {
        setStatistics(data.trees[connectionId]);
      }
    };

    // Subscribe to events
    topicTreeService.on('treeUpdated', handleTreeUpdated);
    topicTreeService.on('nodeToggled', handleNodeToggled);
    topicTreeService.on('treeExpanded', handleTreeExpanded);
    topicTreeService.on('treeCleared', handleTreeCleared);
    topicTreeService.on('treeRemoved', handleTreeRemoved);
    topicTreeService.on('ratesUpdated', handleRatesUpdated);

    // Cleanup
    return () => {
      topicTreeService.off('treeUpdated', handleTreeUpdated);
      topicTreeService.off('nodeToggled', handleNodeToggled);
      topicTreeService.off('treeExpanded', handleTreeExpanded);
      topicTreeService.off('treeCleared', handleTreeCleared);
      topicTreeService.off('treeRemoved', handleTreeRemoved);
      topicTreeService.off('ratesUpdated', handleRatesUpdated);
    };
  }, [connectionId, topicTreeService]);

  const handleNodeClick = (node) => {
    // Check if node has direct messages (either leaf or parent with messages)
    const hasDirectMessages = node.hasDirectMessages || node.isLeaf;
    const hasMessages = node.messageCount > 0;
    
    // ALWAYS toggle expansion if it has children
    if (node.hasChildren) {
      topicTreeService.toggleTopicNode(connectionId, node.fullPath);
    }
    
    // Select topic for message viewing if it has messages
    if (hasDirectMessages && hasMessages) {
      setSelectedNode(node.fullPath);
      if (onTopicSelect) {
        onTopicSelect(node.fullPath, node);
      }
    }
    // For nodes without direct messages but with children, still allow selection 
    // if they somehow have messages (edge case)
    else if (hasMessages) {
      setSelectedNode(node.fullPath);
      if (onTopicSelect) {
        onTopicSelect(node.fullPath, node);
      }
    }
  };

  const handleExpandAll = () => {
    topicTreeService.expandTopicTreeToDepth(connectionId, 10);
  };

  const handleCollapseAll = () => {
    topicTreeService.expandTopicTreeToDepth(connectionId, 0);
  };

  const handleClearTree = () => {
    topicTreeService.clearTopicTree(connectionId);
  };

  if (isLoading) {
    return (
      <div className="topic-tree-container">
        <div className="topic-tree-header">
          <h3>Topic Tree</h3>
          <div className="topic-tree-stats">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="topic-tree-container">
        <div className="topic-tree-header">
          <h3>Topic Tree</h3>
          <div className="topic-tree-stats">
            No topics yet - waiting for messages...
          </div>
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
            <button onClick={handleExpandAll} className="tree-control-btn expand-btn" title="Expand all topics">
              <i className="fas fa-expand-arrows-alt"></i>
            </button>
            <button onClick={handleCollapseAll} className="tree-control-btn collapse-btn" title="Collapse all topics">
              <i className="fas fa-compress-arrows-alt"></i>
            </button>
            <button onClick={handleClearTree} className="tree-control-btn clear-btn" title="Clear topic tree">
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
              <i className="fas fa-tachometer-alt"></i> {statistics.totalRate.toFixed(1)} msg/s
            </span>
          </div>
        )}
      </div>
      
      <div className="topic-tree-content">
        {nodes.map((node) => (
          <TopicTreeNode
            key={node.fullPath}
            node={node}
            onClick={() => handleNodeClick(node)}
            isSelected={selectedNode === node.fullPath}
          />
        ))}
      </div>
    </div>
  );
}

export default TopicTreeComponent;