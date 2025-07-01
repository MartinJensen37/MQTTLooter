import React, { useState } from 'react';
import './PublishingPanel.css';

function PublishingPanel({ 
  connectionId,
  onPublishMessage 
}) {
  const [topic, setTopic] = useState('');
  const [payload, setPayload] = useState('');
  const [qos, setQos] = useState(0);
  const [retain, setRetain] = useState(false);
  const [publishHistory, setPublishHistory] = useState([]);

  const handlePublish = () => {
    if (!topic.trim()) {
      alert('Please enter a topic');
      return;
    }

    const messageData = {
      topic: topic.trim(),
      payload,
      qos,
      retain,
      timestamp: new Date().toISOString()
    };

    if (onPublishMessage) {
      onPublishMessage(messageData);
    }

    // Add to history
    setPublishHistory(prev => [...prev.slice(-9), messageData]); // Keep last 10

    // Clear form
    setTopic('');
    setPayload('');
    setQos(0);
    setRetain(false);
  };

  const loadFromHistory = (historyItem) => {
    setTopic(historyItem.topic);
    setPayload(historyItem.payload);
    setQos(historyItem.qos);
    setRetain(historyItem.retain);
  };

  return (
    <div className="publishing-panel">
      <div className="publishing-panel-header">
        <h2>Message Publishing</h2>
      </div>

      <div className="publishing-content">
        <div className="publish-form">
          <div className="form-group">
            <label htmlFor="topic">Topic:</label>
            <input
              id="topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter MQTT topic (e.g., sensors/temperature)"
              className="topic-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="payload">Payload:</label>
            <textarea
              id="payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder="Enter message payload"
              className="payload-input"
              rows={6}
            />
          </div>

          <div className="form-options">
            <div className="form-group">
              <label htmlFor="qos">QoS:</label>
              <select
                id="qos"
                value={qos}
                onChange={(e) => setQos(parseInt(e.target.value))}
                className="qos-select"
              >
                <option value={0}>0 - At most once</option>
                <option value={1}>1 - At least once</option>
                <option value={2}>2 - Exactly once</option>
              </select>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                />
                Retain message
              </label>
            </div>
          </div>

          <button 
            onClick={handlePublish} 
            className="publish-btn"
            disabled={!topic.trim()}
          >
            <i className="fas fa-paper-plane"></i> Publish Message
          </button>
        </div>

        {publishHistory.length > 0 && (
          <div className="publish-history">
            <h3>Recent Publications</h3>
            <div className="history-list">
              {publishHistory.slice().reverse().map((item, index) => (
                <div key={index} className="history-item">
                  <div className="history-header">
                    <span className="history-topic">{item.topic}</span>
                    <span className="history-time">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    <button 
                      onClick={() => loadFromHistory(item)}
                      className="load-btn"
                      title="Load into form"
                    >
                      <i className="fas fa-redo"></i>
                    </button>
                  </div>
                  <div className="history-payload">
                    {item.payload.length > 50 
                      ? item.payload.substring(0, 50) + '...' 
                      : item.payload}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PublishingPanel;