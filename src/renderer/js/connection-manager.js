const EventEmitter = require('events');
const MQTTClient = require('./mqtt-client');
const { generateClientId } = require('./utils');

class ConnectionManager extends EventEmitter {
    constructor() {
        super();
        this.connections = {};
        this.activeConnection = null;
    }

    async loadConnections() {
        try {
            const saved = localStorage.getItem('mqttConnections');
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.keys(parsed).forEach(id => {
                    const conn = parsed[id];
                    this.connections[id] = {
                        ...conn,
                        client: null,
                        connected: false,
                        hasError: false,
                        topicTree: conn.topicTree || {},
                        subscriptionTopics: conn.subscriptionTopics || ['#'],
                        clientId: conn.clientId || generateClientId()
                    };
                });
            }
        } catch (e) {
            console.error('Error loading saved connections:', e);
        }
    }

    saveConnections() {
        const connectionsToSave = {};
        Object.keys(this.connections).forEach(id => {
            const conn = this.connections[id];
            connectionsToSave[id] = {
                id: conn.id,
                name: conn.name,
                url: conn.url,
                clientId: conn.clientId,
                username: conn.username,
                password: conn.password,
                subscriptionTopics: conn.subscriptionTopics || ['#'],
                topicTree: conn.topicTree || {}
            };
        });
        localStorage.setItem('mqttConnections', JSON.stringify(connectionsToSave));
        console.log('Connections saved:', connectionsToSave);
    }

    addConnection(connectionData) {
        console.log('Adding connection:', connectionData);
        const id = Date.now().toString();
        const connection = {
            id,
            ...connectionData,
            clientId: connectionData.clientId || generateClientId(),
            subscriptionTopics: connectionData.subscriptionTopics || ['#'],
            topicTree: {},
            client: null,
            connected: false,
            hasError: false
        };

        this.connections[id] = connection;
        console.log('Connection added, total connections:', Object.keys(this.connections).length);
        this.saveConnections();
        this.emit('connection-added', connection);
        return connection;
    }

    updateConnection(id, connectionData) {
        console.log('Updating connection:', id, connectionData);
        if (this.connections[id]) {
            const connection = this.connections[id];
            
            if (connection.client) {
                console.log('Cleaning up old client before update');
                try {
                    // DISABLE RECONNECTION FIRST
                    if (connection.client.client && connection.client.client.options) {
                        connection.client.client.options.reconnectPeriod = 0;
                        connection.client.client.options.connectTimeout = 1000;
                    }
                    
                    // Remove all listeners to prevent memory leaks and callbacks
                    connection.client.removeAllListeners();
                    
                    // Force disconnect the client
                    connection.client.disconnect(true); // Force disconnect
                    
                    // Clear the client reference immediately
                    connection.client = null;
                    
                    // Wait a moment to ensure cleanup
                    setTimeout(() => {
                        console.log('Client cleanup completed for update');
                    }, 100);
                    
                } catch (error) {
                    console.warn('Error during client cleanup:', error);
                    connection.client = null; // Clear it anyway
                }
            }
            
            // Reset connection state
            connection.connected = false;
            connection.hasError = false;
            connection.connecting = false;
            
            // CLEAR TOPIC TREE WHEN CONNECTION IS UPDATED
            connection.topicTree = {};
            
            // Update connection data
            Object.assign(connection, connectionData);
            
            // If this was the active connection, clear it temporarily
            if (this.activeConnection && this.activeConnection.id === id) {
                this.activeConnection = null;
            }
            
            this.saveConnections();
            this.emit('connection-updated', connection);
            
            console.log('Connection updated successfully:', connection.name);
        }
    }

    editConnection(connectionId) {
        console.log('Edit connection called for:', connectionId);
        const connection = this.connections[connectionId];
        if (connection) {
            // If editing the currently active connection, clear its topic tree display
            if (this.activeConnection && this.activeConnection.id === connectionId) {
                this.emit('connection-editing', connectionId);
            }
            
            this.emit('edit-connection-requested', connectionId, connection);
            
            if (window.modalManager) {
                window.modalManager.showConnectionModal(connectionId);
            }
        } else {
            console.error('Connection not found:', connectionId);
        }
    }

    deleteConnection(id) {
        console.log('Deleting connection:', id);
        if (this.connections[id]) {
            this.disconnectConnection(id);
            delete this.connections[id];
            
            if (this.activeConnection && this.activeConnection.id === id) {
                this.activeConnection = null;
            }
            
            this.saveConnections();
            this.emit('connection-deleted', id);
        }
    }

    connectToMqtt(connectionId) {
        console.log('Connecting to MQTT:', connectionId);
        const connection = this.connections[connectionId];
        if (!connection) {
            console.error('Connection not found:', connectionId);
            return;
        }

        // ENSURE OLD CLIENT IS COMPLETELY CLEANED UP
        if (connection.client) {
            console.log('Cleaning up existing client before new connection');
            try {
                connection.client.removeAllListeners();
                connection.client.disconnect(true);
            } catch (error) {
                console.warn('Error cleaning up old client:', error);
            }
            connection.client = null;
        }

        // Reset connection state
        connection.connected = false;
        connection.hasError = false;
        connection.connecting = true; // Set connecting state
        
        // CLEAR TOPIC TREE BEFORE CONNECTING
        connection.topicTree = {};
        
        // Set as active connection immediately (before actually connecting)
        this.activeConnection = connection;
        
        // Re-render to show the connection as active but with empty tree
        this.render();
        this.emit('active-connection-changed', connection);

        // Create new client
        console.log('Creating new MQTT client for:', connection.url);
        connection.client = new MQTTClient(connection);
        
        // Set up event handlers
        connection.client.on('connected', () => {
            console.log('MQTT connected:', connection.name);
            connection.connected = true;
            connection.hasError = false;
            connection.connecting = false;
            this.render(); // Update UI to show connected state
            this.emit('connection-connected', connection);
        });

        connection.client.on('message', (topic, message) => {
            // Only process messages if this is still the active connection
            if (this.activeConnection && this.activeConnection.id === connectionId) {
                this.updateTreeStructure(connection, topic, message);
                this.emit('message-received', connectionId, topic, message);
            }
        });

        connection.client.on('error', (err) => {
            console.error('MQTT connection error:', err);
            connection.connected = false;
            connection.hasError = true;
            connection.connecting = false;
            this.render(); // Update UI to show error state
            this.emit('connection-error', connection, err);
        });

        connection.client.on('disconnected', () => {
            console.log('MQTT disconnected:', connection.name);
            connection.connected = false;
            connection.connecting = false;
            this.render(); // Update UI
            this.emit('connection-disconnected', connection);
        });

        // Attempt connection
        try {
            connection.client.connect();
        } catch (error) {
            console.error('Failed to start connection:', error);
            connection.connected = false;
            connection.hasError = true;
            connection.connecting = false;
            connection.client = null;
            this.render();
        }
    }

    disconnectConnection(connectionId) {
        console.log('Disconnecting connection:', connectionId);
        const connection = this.connections[connectionId];
        
        if (connection) {
            // Set disconnecting state to prevent new operations
            connection.connecting = false;
            connection.connected = false;
            
            if (connection.client) {
                try {
                    console.log('Aggressively cleaning up MQTT client for:', connection.name);
                    
                    // DISABLE RECONNECTION FIRST - More aggressive approach
                    if (connection.client.client) {
                        const mqttClient = connection.client.client;
                        
                        // Disable all reconnection options
                        if (mqttClient.options) {
                            mqttClient.options.reconnectPeriod = 0;
                            mqttClient.options.connectTimeout = 1000;
                            mqttClient.options.keepalive = 0;
                            mqttClient.options.clean = true;
                        }
                        
                        // Force end the connection immediately
                        if (mqttClient.connected || mqttClient.connecting) {
                            mqttClient.end(true, () => {
                                console.log('MQTT client forcefully terminated');
                            });
                        }
                        
                        // Clear any pending timers
                        if (mqttClient.pingTimer) {
                            clearTimeout(mqttClient.pingTimer);
                        }
                        if (mqttClient.reconnectTimer) {
                            clearTimeout(mqttClient.reconnectTimer);
                        }
                    }
                    
                    // Remove all event listeners first to prevent callbacks
                    connection.client.removeAllListeners();
                    
                    // Force disconnect with cleanup
                    connection.client.disconnect(true);
                    
                    // Clear the client reference
                    connection.client = null;
                    
                } catch (error) {
                    console.warn('Error during disconnect cleanup:', error);
                    // Force clear the client even if there was an error
                    connection.client = null;
                }
            }
            
            // Reset all connection state
            connection.hasError = false;
            connection.connecting = false;
            
            // CLEAR TOPIC TREE DATA ON DISCONNECT
            connection.topicTree = {};
            
            // If this was the active connection, clear it
            if (this.activeConnection && this.activeConnection.id === connectionId) {
                this.activeConnection = null;
            }
            
            // Emit disconnection event
            this.emit('connection-disconnected', connection);
            
            // Save the updated state (without topic tree)
            this.saveConnections();
            
            // Re-render to update the UI
            this.render();
            
            console.log('Successfully disconnected and cleared topic tree:', connection.name);
        } else {
            console.warn('Connection not found:', connectionId);
        }
    }

    updateTreeStructure(connection, topic, message) {
        if (!connection) return;
        
        const parts = topic.split('/');
        let current = connection.topicTree;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            if (!current[part]) {
                current[part] = {
                    children: {},
                    messages: [],
                    isExpanded: true,
                    fullTopic: null
                };
            }
            
            if (i === parts.length - 1) {
                current[part].fullTopic = topic;
                current[part].messages.unshift({
                    value: message,
                    timestamp: new Date().toISOString()
                });
                
                // Keep only the last 50 messages per topic
                if (current[part].messages.length > 50) {
                    current[part].messages = current[part].messages.slice(0, 50);
                }
            }
            
            current = current[part].children;
        }
        
        this.saveConnections();
    }

    render() {
        console.log('Rendering connections, count:', Object.keys(this.connections).length);
        
        const connectionsContainer = document.getElementById('connection-list');
        
        if (!connectionsContainer) {
            console.error('Connection list container not found');
            return;
        }

        connectionsContainer.innerHTML = '';
        
        if (Object.keys(this.connections).length === 0) {
            const noConnectionsItem = document.createElement('li');
            noConnectionsItem.className = 'connection-item';
            noConnectionsItem.innerHTML = `
                <div class="connection-name">No connections configured</div>
                <div class="connection-url">Click the + button below to add your first connection</div>
            `;
            connectionsContainer.appendChild(noConnectionsItem);
            return;
        }
        
        Object.values(this.connections).forEach(connection => {
            const connectionElement = this.createConnectionElement(connection);
            connectionsContainer.appendChild(connectionElement);
        });
        
        console.log('Rendered', Object.keys(this.connections).length, 'connections');
    }

   createConnectionElement(connection) {
        const li = document.createElement('li');
        
        // Apply the proper CSS classes based on connection state
        let connectionClasses = 'connection-item';
        let statusText = 'Disconnected';
        
        if (this.activeConnection && this.activeConnection.id === connection.id) {
            connectionClasses += ' active';
        }
        
        if (connection.connecting) {
            connectionClasses += ' connecting';
            statusText = 'Connecting...';
        } else if (connection.connected) {
            connectionClasses += ' connected';
            statusText = 'Connected';
        } else if (connection.hasError) {
            connectionClasses += ' error';
            statusText = 'Connection Error';
        } else {
            connectionClasses += ' disconnected';
        }
        
        li.className = connectionClasses;
        
        // Determine power button state and content
        let powerButtonClass = 'power-btn';
        let powerButtonText = '';
        let powerButtonAction = '';
        let powerButtonDisabled = '';
        
        if (connection.connecting) {
            powerButtonClass += ' connecting';
            powerButtonText = '<span class="btn-icon">⟳</span> Connecting...';
            powerButtonAction = `onclick="window.connectionManager.disconnectConnection('${connection.id}')"`;
        } else if (connection.connected) {
            powerButtonClass += ' connected';
            powerButtonText = '<span class="btn-icon">●</span> ON';
            powerButtonAction = `onclick="window.connectionManager.disconnectConnection('${connection.id}')"`;
        } else {
            powerButtonText = '<span class="btn-icon">○</span> OFF';
            powerButtonAction = `onclick="window.connectionManager.connectToMqtt('${connection.id}')"`;
        }
        
        // Create the connection element using the proper HTML structure
        li.innerHTML = `
            <div class="connection-name">${connection.name}</div>
            <div class="connection-url">${connection.url}</div>
            <div class="connection-status">${statusText}</div>
            <div class="connection-controls">
                <button class="${powerButtonClass}" 
                        ${powerButtonAction}
                        ${powerButtonDisabled}>
                    ${powerButtonText}
                </button>
                <button class="edit-btn" 
                        onclick="window.connectionManager.editConnection('${connection.id}')">
                    <span class="btn-icon">⚙</span> Edit
                </button>
                <button class="delete-btn" 
                        onclick="window.connectionManager.deleteConnection('${connection.id}')">
                    <span class="btn-icon">✕</span>
                </button>
            </div>
        `;
        
        li.addEventListener('click', (e) => {
            // Don't trigger if clicking on buttons
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            
            // Only set as active if connected
            if (connection.connected) {
                this.setActiveConnection(connection.id);
            } else {
                // Clear active connection if clicking on disconnected connection
                this.setActiveConnection(null);
            }
        });
        
        return li;
    }

    setActiveConnection(connectionId) {
        const connection = this.connections[connectionId];
        if (connection && connection.connected) { // Only set as active if connected
            // Clear previous active connection visual state
            if (this.activeConnection) {
                this.activeConnection.isActive = false;
            }
            
            // Set new active connection
            this.activeConnection = connection;
            connection.isActive = true;
            
            // Re-render to update visual states
            this.render();
            
            // Emit event for other components
            this.emit('active-connection-changed', connection);
        } else if (connection && !connection.connected) {
            // If trying to set a disconnected connection as active, clear active connection
            if (this.activeConnection) {
                this.activeConnection.isActive = false;
            }
            this.activeConnection = null;
            
            // Re-render to update visual states
            this.render();
            
            // Emit event to clear displays
            this.emit('active-connection-changed', null);
        }
    }

    getAllConnections() {
        return this.connections;
    }

    getConnectionCount() {
        return Object.keys(this.connections).length;
    }
}

module.exports = ConnectionManager;