import React from 'react';

function TopicTreeNode({ node, onClick, isSelected }) {
  const indentStyle = { paddingLeft: `${node.depth * 20 + 10}px` };

  const formatRate = (rate) => {
    if (rate >= 1) return `${rate.toFixed(1)}/s`;
    if (rate > 0)  return `${(rate * 60).toFixed(1)}/min`;
    return '';
  };

  const formatMessage = (message) => {
    if (!message || !message.payload) return '';
    let payload = message.payload.toString();
    try {
      payload = JSON.stringify(JSON.parse(payload));
    } catch (_) {}
    return payload;
  };

  const getExpandIcon = () => {
    if (!node.hasChildren) return '';
    return node.isExpanded ? '▼' : '▶';
  };

  const hasStats          = node.messageCount > 0 || node.messageRate > 0;
  const hasPayload        = !!node.lastMessage;
  const hasDirectMessages = node.hasDirectMessages || node.isLeaf;
  const hasRetainedMessage = node.lastMessage?.retain;
  const subtopicCount     = node.hasChildren ? (node.childCount || 0) : 0;

  return (
    <div
      className={`topic-tree-node ${node.hasChildren ? 'has-children' : 'is-leaf'} ${hasDirectMessages ? 'has-messages' : ''} ${isSelected ? 'selected' : ''}`}
      style={indentStyle}
      onClick={() => onClick(node)}
    >
      <div className="node-content">
        <div className="node-left">
          <span className="node-expand-icon">{getExpandIcon()}</span>
          <span className="node-name">{node.name}</span>
          <div className="node-bubbles">
            {hasRetainedMessage && (
              <span className="retained-bubble" title="Has retained message">
                <i className="fas fa-save"></i> Retained
              </span>
            )}
            {subtopicCount > 0 && (
              <span className="subtopic-bubble" title={`${subtopicCount} subtopic${subtopicCount > 1 ? 's' : ''}`}>
                <i className="fas fa-sitemap"></i> {subtopicCount} Subtopic{subtopicCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="node-right">
          {(hasStats || hasPayload) && (
            <>
              {hasStats && (
                <div className="node-stats">
                  {node.messageCount > 0 && <span className="message-count">{node.messageCount}</span>}
                  {node.messageRate > 0  && <span className="message-rate">{formatRate(node.messageRate)}</span>}
                </div>
              )}
              {hasStats && hasPayload && <span className="stats-separator">|</span>}
              {hasPayload && hasDirectMessages && (
                <div className="node-payload">{formatMessage(node.lastMessage)}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(TopicTreeNode);
