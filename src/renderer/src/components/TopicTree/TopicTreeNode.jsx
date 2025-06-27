import React from 'react';

function TopicTreeNode({ node, onClick, isSelected }) {
  const indentStyle = {
    paddingLeft: `${node.depth * 20 + 10}px`
  };

  const formatRate = (rate) => {
    if (rate >= 1) {
      return `${rate.toFixed(1)}/s`;
    } else if (rate > 0) {
      return `${(rate * 60).toFixed(1)}/min`;
    }
    return '';
  };

  const formatMessage = (message) => {
    if (!message || !message.payload) return '';
    let payload = message.payload.toString();
    
    // Try to parse JSON for better display
    try {
      const parsed = JSON.parse(payload);
      payload = JSON.stringify(parsed);
    } catch (e) {
      // Not JSON, keep as is
    }
    
    return payload;
  };

  const getExpandIcon = () => {
    if (node.hasChildren) {
      return node.isExpanded ? '▼' : '▶';
    }
    return '';
  };

  const hasStats = node.messageCount > 0 || node.messageRate > 0;
  const hasPayload = node.lastMessage;

  return (
    <div
      className={`topic-tree-node ${node.hasChildren ? 'has-children' : 'is-leaf'} ${node.isLeaf ? 'has-messages' : ''} ${isSelected ? 'selected' : ''}`}
      style={indentStyle}
      onClick={onClick}
    >
      <div className="node-content">
        <div className="node-left">
          <span className="node-expand-icon">
            {getExpandIcon()}
          </span>
          <span className="node-name">{node.name}</span>
        </div>
        
        <div className="node-right">
          {/* Stats and payload in one line */}
          {(hasStats || hasPayload) && (
            <>
              {/* Message count and rate */}
              {hasStats && (
                <div className="node-stats">
                  {node.messageCount > 0 && (
                    <span className="message-count">
                      {node.messageCount}
                    </span>
                  )}
                  {node.messageRate > 0 && (
                    <span className="message-rate">
                      {formatRate(node.messageRate)}
                    </span>
                  )}
                </div>
              )}
              
              {/* Separator between stats and payload */}
              {hasStats && hasPayload && (
                <span className="stats-separator">|</span>
              )}
              
              {/* Payload */}
              {hasPayload && (
                <div className="node-payload">
                  {formatMessage(node.lastMessage)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Additional details for leaf nodes when selected */}
      {isSelected && node.isLeaf && node.lastMessage && (
        <div className="node-details" style={{ paddingLeft: `${(node.depth + 1) * 20 + 10}px` }}>
          <div className="node-topic-path">
            <strong>Topic:</strong> {node.fullPath}
          </div>
          <div className="node-message-info">
            <span className="qos-info">QoS: {node.lastMessage.qos}</span>
            {node.lastMessage.retain && <span className="retain-info">Retained</span>}
            <span className="timestamp-info">
              {new Date(node.lastMessageTime).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default TopicTreeNode;