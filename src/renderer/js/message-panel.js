const EventEmitter = require('events');
const { escapeHtml, formatTimestamp } = require('./utils');

class MessagePanel extends EventEmitter {
    constructor() {
        super();
        this.messagePanel = document.querySelector('.message-panel');
        this.messageHeader = document.querySelector('.message-header');
        this.messageContent = document.querySelector('.message-content');
        this.messageDetails = document.getElementById('message-details');
        this.currentTopic = null;
        this.currentConnection = null;
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Add any message panel specific event handlers here
    }

    showTopicMessages(topic, connection = null) {
        this.currentTopic = topic;
        this.currentConnection = connection;

        if (!connection || !topic) {
            this.showNoSelection();
            return;
        }

        const topicData = this.findTopicInTree(connection.topicTree, topic);
        if (!topicData || !topicData.messages) {
            this.showNoMessages(topic);
            return;
        }

        const messages = topicData.messages;
        this.renderMessages(topic, messages);
    }

    showNoSelection() {
        this.messageDetails.innerHTML = `
            <div class="no-topic-selected">
                Select a topic from the tree to view message history
            </div>
        `;
    }

    showNoMessages(topic) {
        this.messageDetails.innerHTML = `
            <div class="no-topic-selected">
                No messages received for topic: ${escapeHtml(topic)}
            </div>
        `;
    }

    renderMessages(topic, messages) {
        this.messageDetails.innerHTML = `
            <div class="topic-info">
                <div class="topic-path">${escapeHtml(topic)}</div>
                <div style="margin-top: 5px; font-size: 14px; color: #6c757d;">
                    ${messages.length} message${messages.length !== 1 ? 's' : ''}
                </div>
            </div>
            <div class="message-actions">
                <button class="btn btn-sm btn-secondary" onclick="messagePanel.exportMessages('json')">
                    Export JSON
                </button>
                <button class="btn btn-sm btn-secondary" onclick="messagePanel.exportMessages('csv')">
                    Export CSV
                </button>
                <button class="btn btn-sm btn-secondary" onclick="messagePanel.clearMessages()">
                    Clear Messages
                </button>
            </div>
            <div class="message-log">
                ${messages.map(msg => `
                    <div class="message-item">
                        <div class="message-timestamp">${formatTimestamp(msg.timestamp)}</div>
                        <div class="message-value">${escapeHtml(msg.value)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    updateIfSelected(topic, message) {
        if (this.currentTopic === topic && this.currentConnection) {
            // Refresh the display if this topic is currently selected
            this.showTopicMessages(topic, this.currentConnection);
        }
    }

    findTopicInTree(node, targetTopic) {
        for (const [key, value] of Object.entries(node)) {
            if (value.fullTopic === targetTopic) {
                return value;
            }
            
            if (Object.keys(value.children).length > 0) {
                const found = this.findTopicInTree(value.children, targetTopic);
                if (found) return found;
            }
        }
        return null;
    }

    exportMessages(format) {
        if (!this.currentTopic || !this.currentConnection) {
            console.warn('No topic selected for export');
            return;
        }

        const topicData = this.findTopicInTree(this.currentConnection.topicTree, this.currentTopic);
        if (!topicData || !topicData.messages) {
            console.warn('No messages to export');
            return;
        }

        const messages = topicData.messages;
        let exportData;

        switch (format) {
            case 'json':
                exportData = JSON.stringify({
                    topic: this.currentTopic,
                    connection: this.currentConnection.name,
                    exportedAt: new Date().toISOString(),
                    messages: messages
                }, null, 2);
                break;
            case 'csv':
                const csvHeader = 'Timestamp,Topic,Message\n';
                const csvRows = messages.map(msg => 
                    `"${msg.timestamp}","${this.currentTopic}","${msg.value.replace(/"/g, '""')}"`
                ).join('\n');
                exportData = csvHeader + csvRows;
                break;
            default:
                console.error('Unsupported export format');
                return;
        }

        // Create download
        const blob = new Blob([exportData], { 
            type: format === 'json' ? 'application/json' : 'text/csv' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mqtt-messages-${this.currentTopic.replace(/[/\\?%*:|"<>]/g, '-')}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.emit('messages-exported', { topic: this.currentTopic, format, count: messages.length });
    }

    clearMessages() {
        if (!this.currentTopic || !this.currentConnection) {
            return;
        }

        const topicData = this.findTopicInTree(this.currentConnection.topicTree, this.currentTopic);
        if (topicData) {
            topicData.messages = [];
            this.showTopicMessages(this.currentTopic, this.currentConnection);
            this.emit('messages-cleared', { topic: this.currentTopic });
        }
    }

    clear() {
        this.currentTopic = null;
        this.currentConnection = null;
        this.showNoSelection();
    }
}

module.exports = MessagePanel;