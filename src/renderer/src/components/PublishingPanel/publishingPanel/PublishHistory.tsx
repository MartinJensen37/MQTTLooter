import React from 'react';
import type { PublishHistoryItem } from './types';

interface Props {
  publishHistory: PublishHistoryItem[];
  clearHistory: () => void;
  loadFromHistory: (item: PublishHistoryItem) => void;
}

function PublishHistory({ publishHistory, clearHistory, loadFromHistory }: Props) {
  return (
    <div className="publish-history">
      <div className="history-header">
        <h3>Publication History</h3>
        <button onClick={clearHistory} className="clear-history-btn" title="Clear history">
          <i className="fas fa-trash"></i>
        </button>
      </div>
      <div className="history-list">
        {publishHistory.map((item, index) => (
          <div key={index} className="history-item">
            <div className="history-item-header">
              <div className="history-meta">
                <span className="history-topic">
                  <i className="fas fa-tag"></i> {item.topic}
                </span>
                <div className="history-badges">
                  <span className={`badge badge-qos-${item.qos}`}>QoS {item.qos}</span>
                  {item.retain && (
                    <span className="badge badge-retain">
                      <i className="fas fa-save"></i> R
                    </span>
                  )}
                </div>
              </div>
              <div className="history-actions">
                <span className="history-time">
                  <i className="fas fa-clock"></i> {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => loadFromHistory(item)}
                  className="load-btn"
                  title="Load into form"
                >
                  <i className="fas fa-redo"></i>
                </button>
              </div>
            </div>
            <div className="history-payload">
              {item.payload.length > 100 ? item.payload.substring(0, 100) + '...' : item.payload}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default React.memo(PublishHistory);
