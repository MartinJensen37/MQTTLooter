const ConnectionManager = require('./js/connection-manager');
const TopicTree = require('./js/topic-tree');
const MessagePanel = require('./js/message-panel');
const ModalManager = require('./js/modal-manager');
const { showToast } = require('./js/utils');
class MQTTLooterApp {
    constructor() {
        this.connectionManager = new ConnectionManager();
        this.topicTree = new TopicTree();
        this.messagePanel = new MessagePanel(this.topicTree);
        this.modalManager = new ModalManager();
        
        // Connect ConnectionManager and TopicTree
        this.connectionManager.setTopicTree(this.topicTree);
        
        // Track window visibility
        this.isWindowVisible = true;
        this.setupVisibilityHandling();
        
        this.initialize();
    }

    setupVisibilityHandling() {
        // Handle window focus/blur events
        window.addEventListener('focus', () => {
            this.isWindowVisible = true;
            console.log('Window focused - forcing updates');
            this.topicTree.forceUpdate();
            this.messagePanel.refreshWhenVisible();
        });

        window.addEventListener('blur', () => {
            // Don't disable updates when window loses focus
            // Background processing should continue
            console.log('Window blurred - continuing background processing');
        });

        // Handle visibility change (minimize/restore)
        document.addEventListener('visibilitychange', () => {
            this.isWindowVisible = !document.hidden;
            console.log('Visibility changed:', this.isWindowVisible ? 'visible' : 'hidden');
            
            if (this.isWindowVisible) {
                // Force refresh when window becomes visible
                setTimeout(() => {
                    this.topicTree.forceUpdate();
                    this.messagePanel.refreshWhenVisible();
                }, 100);
            }
        });
    }

    async initialize() {
        await this.connectionManager.loadConnections();
        this.setupEventHandlers();
        this.render();
        
        // Add global reference for HTML onclick handlers
        window.connectionManager = this.connectionManager;
        window.messagePanel = this.messagePanel;
        window.topicTree = this.topicTree;
        window.modalManager = this.modalManager;
    }

    setupEventHandlers() {
        // Menu events
        if (window.electronAPI) {
            window.electronAPI.onMenuNewConnection(() => {
                this.modalManager.showConnectionModal();
            });
        }

        // Connection Manager events
        this.connectionManager.on('connection-added', (connection) => {
            showToast(`Connection "${connection.name}" added successfully`, 'success');
            this.render();
        });

        this.connectionManager.on('connection-updated', (connection) => {
            showToast(`Connection "${connection.name}" updated successfully`, 'success');
            this.topicTree.clear();
            this.messagePanel.clear();
            this.render();
        });

        this.connectionManager.on('connection-deleted', (connectionId) => {
            showToast('Connection deleted', 'info');
            this.topicTree.clear();
            this.messagePanel.clear();
            this.render();
        });

        this.connectionManager.on('connection-disconnected', (connection) => {
            console.log('Connection disconnected:', connection.name);
            showToast(`Disconnected from ${connection.name}`, 'info');
            
            if (this.connectionManager.activeConnection && 
                this.connectionManager.activeConnection.id === connection.id) {
                this.topicTree.clear();
                this.messagePanel.clear();
            }
            
            this.render();
        });

        this.connectionManager.on('connection-connected', (connection) => {
            showToast(`Connected to ${connection.name}`, 'success');
            this.render();
        });

        this.connectionManager.on('connection-error', (connection, error) => {
            showToast(`Connection error: ${connection.name} - ${error.message}`, 'error');
            this.render();
        });

        // CRITICAL: Always process messages regardless of window visibility
        this.connectionManager.on('message-received', (connectionId, topic, message) => {
            const activeConnection = this.connectionManager.activeConnection;
            if (activeConnection && activeConnection.id === connectionId && activeConnection.connected) {
                // Always update message panel if topic is selected
                this.messagePanel.updateIfSelected(topic, message);
                // TopicTree handles its own updates in background
            }
        });

        this.connectionManager.on('active-connection-changed', (connection) => {
            console.log('Active connection changed to:', connection?.name || 'none');
            this.topicTree.clear();
            this.messagePanel.clear();
            this.topicTree.render(connection);
            this.updateConnectionIndicator();
        });

        // Topic Tree events - ONLY for actual user selections
        this.topicTree.on('topic-selected', (topic) => {
            const activeConnection = this.connectionManager.activeConnection;
            if (activeConnection) {
                this.messagePanel.showTopicMessages(topic, activeConnection);
            }
        });

        this.topicTree.on('selection-cleared', () => {
            this.messagePanel.clear();
        });

        // Modal Manager events
        this.modalManager.on('connection-added', (connectionData) => {
            this.connectionManager.addConnection(connectionData);
        });

        this.modalManager.on('connection-updated', (connectionId, connectionData) => {
            this.connectionManager.updateConnection(connectionId, connectionData);
        });

        this.modalManager.on('request-connection-data', (connectionId) => {
            const connection = this.connectionManager.connections[connectionId];
            if (connection) {
                this.modalManager.populateForm(connection);
            }
        });

        this.modalManager.on('form-error', (message) => {
            showToast(message, 'error');
        });

        // Add connection button
        const addConnectionBtn = document.getElementById('add-connection-btn');
        if (addConnectionBtn) {
            addConnectionBtn.addEventListener('click', () => {
                this.modalManager.showConnectionModal();
            });
        }
    }

    render() {
        this.connectionManager.render();
        this.updateConnectionIndicator();
    }

    updateConnectionIndicator() {
        const connectionText = document.getElementById('connection-text');
        const statusDot = document.getElementById('status-dot');
        
        if (!connectionText || !statusDot) return;
        
        const activeConnection = this.connectionManager.activeConnection;
        
        if (!activeConnection) {
            connectionText.textContent = 'No connection';
            statusDot.className = 'status-dot';
        } else if (activeConnection.connected) {
            connectionText.textContent = `Connected to ${activeConnection.name}`;
            statusDot.className = 'status-dot connected';
        } else if (activeConnection.hasError) {
            connectionText.textContent = `Error: ${activeConnection.name}`;
            statusDot.className = 'status-dot error';
        } else {
            connectionText.textContent = `Connecting to ${activeConnection.name}...`;
            statusDot.className = 'status-dot';
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MQTTLooterApp();
});