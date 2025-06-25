const mqtt = require('mqtt');
const { ipcRenderer } = require('electron');

// DOM elements
const treeView = document.getElementById('tree-view');
const connectionList = document.getElementById('connection-list');
const connectionText = document.getElementById('connection-text');
const statusDot = document.getElementById('status-dot');
const messageDetails = document.getElementById('message-details');

// Modal elements
const connectionModal = document.getElementById('connection-modal');
const modalTitle = document.getElementById('modal-title');
const modalClose = document.getElementById('modal-close');
const modalCancel = document.getElementById('modal-cancel');
const connectionForm = document.getElementById('connection-form');
const addConnectionBtn = document.getElementById('add-connection-btn');
const addSubscriptionBtn = document.getElementById('add-subscription-btn');

// Form elements
const connectionNameInput = document.getElementById('connection-name');
const protocolSelect = document.getElementById('protocol-select');
const brokerHostInput = document.getElementById('broker-host');
const brokerPortInput = document.getElementById('broker-port');
const clientIdInput = document.getElementById('client-id');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const subscriptionList = document.getElementById('subscription-list');

// Global state
let connections = {};
let activeConnection = null;
let selectedTopic = null;
let editingConnectionId = null;
let protocolChangeListenerAdded = false; // Move this declaration to the top

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    loadConnections();
    updateConnectionIndicator();
    
    // Add event listeners
    addConnectionBtn.addEventListener('click', () => openModal('add'));
    modalClose.addEventListener('click', closeModal);
    modalCancel.addEventListener('click', closeModal);
    connectionForm.addEventListener('submit', handleFormSubmit);
    addSubscriptionBtn.addEventListener('click', () => addSubscriptionField());

    // Add protocol change listener only once
    if (!protocolChangeListenerAdded) {
        protocolSelect.addEventListener('change', function() {
            const currentPort = brokerPortInput.value;
            const defaultPort = getDefaultPort(protocolSelect.value);
            
            // Only update port if it's empty or matches a default port
            if (!currentPort || 
                currentPort === '1883' || 
                currentPort === '8883' || 
                currentPort === '8080') {
                brokerPortInput.value = defaultPort;
            }
        });
        protocolChangeListenerAdded = true;
    }

    // Close modal when clicking outside
    connectionModal.addEventListener('click', (e) => {
        if (e.target === connectionModal) closeModal();
    });

    // Clear selection when clicking on empty tree area
    treeView.addEventListener('click', (e) => {
        if (e.target === treeView) clearSelection();
    });

    // ESC key to close modal or clear selection
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (connectionModal.style.display === 'block') {
                closeModal();
            } else {
                clearSelection();
            }
        }
    });
}

function showToast(message, type = 'info') {
    const backgroundColor = {
        'success': '#2ecc71',
        'error': '#e74c3c',
        'warning': '#f39c12',
        'info': '#3498db'
    };

    // Check if Toastify is available
    if (typeof Toastify !== 'undefined') {
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: {
                background: backgroundColor[type] || backgroundColor.info,
            }
        }).showToast();
    } else {
        // Fallback to console.log if Toastify is not available
        console.log(`${type.toUpperCase()}: ${message}`);
        // Create a simple visual feedback
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${backgroundColor[type] || backgroundColor.info};
            color: white;
            padding: 12px 20px;
            border-radius: 5px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 3000);
    }
}

function updateConnectionIndicator() {
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
    
    // Also update the tree header when connection status changes
    renderTree();
}

function generateClientId() {
    return `MQTTLooter-${Math.random().toString(36).substr(2, 9)}`;
}

function openModal(mode, connectionId = null) {
    try {
        editingConnectionId = connectionId;
        
        // Clear the form first to reset all fields
        clearForm();
        
        if (mode === 'add') {
            modalTitle.textContent = 'Add Connection';
            // clearForm() already called above
        } else if (mode === 'edit' && connectionId) {
            modalTitle.textContent = 'Edit Connection';
            const connection = connections[connectionId];
            if (connection) {
                populateForm(connection);
            }
        }
        
        connectionModal.style.display = 'block';
        
        // Focus on the connection name input after a short delay
        setTimeout(() => {
            try {
                connectionNameInput.focus();
                connectionNameInput.select(); // Select all text if editing
            } catch (e) {
                console.error('Error focusing input:', e);
            }
        }, 100);
    } catch (error) {
        console.error('Error opening modal:', error);
        showToast('Error opening connection form', 'error');
    }
}

function closeModal() {
    try {
        connectionModal.style.display = 'none';
        editingConnectionId = null;
        clearForm();
    } catch (error) {
        console.error('Error closing modal:', error);
    }
}

function clearForm() {
    try {
        connectionNameInput.value = '';
        protocolSelect.value = 'mqtt';
        brokerHostInput.value = '';
        brokerPortInput.value = getDefaultPort('mqtt');
        clientIdInput.value = generateClientId();
        usernameInput.value = '';
        passwordInput.value = '';
        
        // Reset subscription list
        subscriptionList.innerHTML = '';
        addSubscriptionField('#');
    } catch (error) {
        console.error('Error clearing form:', error);
    }
}

function populateForm(connection) {
    try {
        // Populate all fields with existing values
        connectionNameInput.value = connection.name || '';
        
        if (connection.url) {
            try {
                const url = new URL(connection.url);
                protocolSelect.value = url.protocol.replace(':', '') || 'mqtt';
                brokerHostInput.value = url.hostname || '';
                brokerPortInput.value = url.port || getDefaultPort(url.protocol.replace(':', ''));
            } catch (e) {
                console.error('Error parsing connection URL:', e);
                // Fallback - try to parse manually
                const urlParts = connection.url.split('://');
                if (urlParts.length === 2) {
                    protocolSelect.value = urlParts[0] || 'mqtt';
                    const hostPort = urlParts[1].split(':');
                    brokerHostInput.value = hostPort[0] || '';
                    brokerPortInput.value = hostPort[1] || getDefaultPort(urlParts[0]);
                }
            }
        } else {
            // Default values if no URL
            protocolSelect.value = 'mqtt';
            brokerHostInput.value = '';
            brokerPortInput.value = getDefaultPort('mqtt');
        }
        
        // Always populate these fields, even if empty
        clientIdInput.value = connection.clientId || generateClientId();
        usernameInput.value = connection.username || '';
        passwordInput.value = connection.password || '';
        
        // Populate subscription topics - ensure we always have at least one field
        subscriptionList.innerHTML = '';
        const topics = connection.subscriptionTopics || ['#'];
        if (topics.length === 0) topics.push('#'); // Ensure at least one topic
        
        topics.forEach(topic => addSubscriptionField(topic));
    } catch (error) {
        console.error('Error populating form:', error);
        showToast('Error loading connection data', 'error');
    }
}

function getDefaultPort(protocol) {
    const ports = { mqtt: '1883', mqtts: '8883', ws: '8080', wss: '8080' };
    return ports[protocol] || '1883';
}

function addSubscriptionField(value = '') {
    try {
        const subscriptionItem = document.createElement('div');
        subscriptionItem.className = 'subscription-item';
        subscriptionItem.innerHTML = `
            <input type="text" class="form-input subscription-input" placeholder="e.g., sensor/+/temperature" value="${escapeHtml(value)}">
            <button type="button" class="remove-subscription-btn">×</button>
        `;
        
        // Add event listener for remove button
        const removeBtn = subscriptionItem.querySelector('.remove-subscription-btn');
        removeBtn.addEventListener('click', () => removeSubscription(removeBtn));
        
        subscriptionList.appendChild(subscriptionItem);
    } catch (error) {
        console.error('Error adding subscription field:', error);
    }
}

function removeSubscription(button) {
    try {
        const subscriptionItem = button.parentElement;
        if (subscriptionList.children.length > 1) {
            subscriptionList.removeChild(subscriptionItem);
        } else {
            // If it's the last item, just clear it but keep one field
            const input = subscriptionItem.querySelector('.subscription-input');
            input.value = '#';
        }
    } catch (error) {
        console.error('Error removing subscription:', error);
    }
}

function getSubscriptionTopics() {
    try {
        const inputs = subscriptionList.querySelectorAll('.subscription-input');
        const topics = [];
        inputs.forEach(input => {
            const topic = input.value.trim();
            if (topic) topics.push(topic);
        });
        return topics.length > 0 ? topics : ['#'];
    } catch (error) {
        console.error('Error getting subscription topics:', error);
        return ['#'];
    }
}

function handleFormSubmit(e) {
    e.preventDefault();
    
    try {
        const name = connectionNameInput.value.trim();
        const protocol = protocolSelect.value;
        const host = brokerHostInput.value.trim();
        const port = brokerPortInput.value.trim();
        const clientId = clientIdInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        const subscriptionTopics = getSubscriptionTopics();
        
        if (!name || !host || !port) {
            showToast('Please provide connection name, host, and port', 'error');
            return;
        }
        
        const portNum = parseInt(port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            showToast('Please provide a valid port number (1-65535)', 'error');
            return;
        }
        
        const url = `${protocol}://${host}:${port}`;
        
        if (editingConnectionId) {
            // Update existing connection
            const connection = connections[editingConnectionId];
            if (!connection) {
                showToast('Connection not found', 'error');
                return;
            }
            
            const wasConnected = connection.connected;
            
            // Properly disconnect and clean up the old connection
            if (wasConnected && connection.client) {
                console.log('Disconnecting old connection for update...');
                connection.client.end(true); // Force close
                connection.client = null;
                connection.connected = false;
                connection.hasError = false;
            }
            
            // Update connection properties
            Object.assign(connection, {
                name, url, clientId: clientId || generateClientId(),
                username: username || null, password: password || null,
                subscriptionTopics, hasError: false
            });
            
            saveConnections();
            renderConnections();
            showToast(`Connection "${name}" updated successfully`, 'success');
            
            // Reconnect if it was previously connected
            if (wasConnected) {
                setTimeout(() => connectToMqtt(editingConnectionId), 500);
            }
        } else {
            // Create new connection
            const connectionId = Date.now().toString();
            connections[connectionId] = {
                id: connectionId, name, url,
                clientId: clientId || generateClientId(),
                username: username || null, password: password || null,
                subscriptionTopics, client: null, connected: false, 
                topicTree: {}, hasError: false
            };
            
            saveConnections();
            renderConnections();
            showToast(`Connection "${name}" added successfully`, 'success');
        }
        
        closeModal();
    } catch (error) {
        console.error('Error handling form submit:', error);
        showToast('Error saving connection', 'error');
    }
}

function deleteConnection(connectionId) {
    const connection = connections[connectionId];
    if (!connection) return;
    
    if (confirm(`Are you sure you want to delete connection "${connection.name}"?`)) {
        try {
            console.log('Deleting connection:', connection.name);
            
            // Properly disconnect and clean up
            if (connection.client) {
                connection.client.end(true); // Force close
                connection.client = null;
            }
            
            // Remove from active connection if needed
            if (activeConnection && activeConnection.id === connectionId) {
                const otherConnected = Object.values(connections).find(conn => conn.id !== connectionId && conn.connected);
                if (otherConnected) {
                    activeConnection = otherConnected;
                    updateConnectionIndicator();
                    renderTree();
                } else {
                    activeConnection = null;
                    selectedTopic = null;
                    updateConnectionIndicator();
                    renderTree();
                    clearMessagePanel();
                }
            }
            
            // Close modal if we're editing this connection
            if (editingConnectionId === connectionId) {
                closeModal();
            }
            
            // Delete from connections object
            delete connections[connectionId];
            
            saveConnections();
            renderConnections();
            showToast(`Connection "${connection.name}" deleted`, 'info');
        } catch (error) {
            console.error('Error deleting connection:', error);
            showToast('Error deleting connection', 'error');
        }
    }
}

// Rest of the functions remain the same...
function connectToMqtt(connectionId) {
    const connection = connections[connectionId];
    if (!connection) {
        console.error('Connection not found:', connectionId);
        return;
    }
    
    // Don't connect if already connected
    if (connection.connected) {
        console.log('Already connected to:', connection.name);
        return;
    }
    
    // Clean up any existing client
    if (connection.client) {
        connection.client.end(true);
        connection.client = null;
    }
    
    connection.hasError = false;
    renderConnections();
    showToast(`Connecting to ${connection.name}...`, 'info');
    
    const options = { 
        clientId: connection.clientId || generateClientId(),
        reconnectPeriod: 0, // Disable automatic reconnection
        connectTimeout: 10000 // 10 second timeout
    };
    
    if (connection.username) options.username = connection.username;
    if (connection.password) options.password = connection.password;
    
    console.log(`Connecting to ${connection.url} with options:`, options);
    const client = mqtt.connect(connection.url, options);
    connection.client = client;
    
    client.on('connect', () => {
        console.log(`Connected to MQTT broker: ${connection.name}`);
        connection.connected = true;
        connection.hasError = false;
        
        // Set as active connection if no active connection exists
        if (!activeConnection) {
            activeConnection = connection;
            updateConnectionIndicator();
            renderTree();
        }
        
        renderConnections();
        showToast(`Connected to ${connection.name}`, 'success');
        
        // Subscribe to topics
        const topics = connection.subscriptionTopics || ['#'];
        topics.forEach(topic => {
            client.subscribe(topic, (err) => {
                if (!err) {
                    console.log(`Subscribed to topic: ${topic} on ${connection.name}`);
                } else {
                    console.error(`Failed to subscribe to ${topic} on ${connection.name}:`, err);
                }
            });
        });
    });
    
    client.on('message', (topic, message) => {
        // Only process messages if connection still exists and is connected
        if (connections[connectionId] && connection.connected) {
            const msg = message.toString();
            console.log(`Received on ${connection.name}: ${topic} - ${msg}`);
            updateTreeStructure(connection, topic, msg);
            
            // Only update display if this is the active connection
            if (activeConnection && activeConnection.id === connectionId) {
                renderTree();
                if (selectedTopic === topic) {
                    showTopicMessages(topic);
                }
            }
        }
    });
    
    client.on('error', (err) => {
        console.error(`MQTT connection error on ${connection.name}:`, err);
        
        // Only process error if connection still exists
        if (connections[connectionId]) {
            connection.connected = false;
            connection.hasError = true;
            
            if (activeConnection && activeConnection.id === connectionId) {
                updateConnectionIndicator();
            }
            renderConnections();
            showToast(`Connection error: ${connection.name} - ${err.message}`, 'error');
        }
    });
    
    client.on('close', () => {
        console.log(`Connection closed: ${connection.name}`);
        
        // Only process close if connection still exists
        if (connections[connectionId]) {
            connection.connected = false;
            
            if (activeConnection && activeConnection.id === connectionId) {
                // Try to find another connected connection to make active
                const otherConnected = Object.values(connections).find(conn => conn.connected && conn.id !== connectionId);
                if (otherConnected) {
                    activeConnection = otherConnected;
                    updateConnectionIndicator();
                    renderTree();
                } else {
                    activeConnection = null;
                    selectedTopic = null;
                    updateConnectionIndicator();
                    renderTree();
                    clearMessagePanel();
                }
            }
            renderConnections();
            
            if (!connection.hasError) {
                showToast(`Disconnected from ${connection.name}`, 'warning');
            }
        }
    });
    
    const timeoutId = setTimeout(() => {
        if (connection.client && !connection.connected) {
            console.log('Connection timeout for:', connection.name);
            connection.client.end(true);
            connection.hasError = true;
            renderConnections();
            showToast(`Connection timeout: ${connection.name}`, 'error');
        }
    }, 15000); // 15 second timeout
    
    // Clear timeout when connected
    client.on('connect', () => {
        clearTimeout(timeoutId);
    });
}

function disconnectConnection(connectionId) {
    const connection = connections[connectionId];
    if (connection && connection.client) {
        console.log('Disconnecting connection:', connection.name);
        connection.client.end(true); // Force close
        connection.client = null;
        connection.connected = false;
        connection.hasError = false;
        
        if (activeConnection && activeConnection.id === connectionId) {
            // Try to find another connected connection to make active
            const otherConnected = Object.values(connections).find(conn => conn.connected && conn.id !== connectionId);
            if (otherConnected) {
                activeConnection = otherConnected;
                updateConnectionIndicator();
                renderTree();
            } else {
                activeConnection = null;
                selectedTopic = null;
                updateConnectionIndicator();
                renderTree();
                clearMessagePanel();
            }
        }
        renderConnections();
        showToast(`Disconnected from ${connection.name}`, 'info');
    }
}

function editConnection(connectionId) {
    openModal('edit', connectionId);
}

function renderConnections() {
    connectionList.innerHTML = '';
    
    Object.values(connections).forEach(connection => {
        const li = document.createElement('li');
        let connectionClass = 'connection-item';
        
        if (connection.connected) {
            connectionClass += ' connected';
        } else if (connection.hasError) {
            connectionClass += ' error';
        } else {
            connectionClass += ' disconnected';
        }
        
        // Add active class if this is the active connection
        if (activeConnection && activeConnection.id === connection.id) {
            connectionClass += ' active';
        }
        
        li.className = connectionClass;
        
        const subscriptionText = connection.subscriptionTopics ? 
            connection.subscriptionTopics.slice(0, 2).join(', ') + 
            (connection.subscriptionTopics.length > 2 ? '...' : '') : '#';
        
        let statusText = 'Disconnected';
        let statusColor = '#95a5a6';
        if (connection.connected) {
            statusText = 'Connected';
            statusColor = '#2ecc71';
        } else if (connection.hasError) {
            statusText = 'Error';
            statusColor = '#e74c3c';
        }
        
        li.innerHTML = `
            <div class="connection-name">${connection.name}</div>
            <div class="connection-url">${connection.url}</div>
            <div class="connection-status" style="color: ${statusColor}; font-weight: bold;">
                ${statusText}
                ${activeConnection && activeConnection.id === connection.id ? ' • ACTIVE VIEW' : ''}
            </div>
            <div style="font-size: 0.8em; color: #bdc3c7; margin-bottom: 8px;">
                Topics: ${subscriptionText}
            </div>
            <div class="connection-controls">
                ${connection.connected ? 
                    '<button class="disconnect-btn">Disconnect</button>' :
                    '<button class="connect-btn">Connect</button>'
                }
                <button class="edit-btn">Edit</button>
                <button class="delete-btn">Delete</button>
            </div>
        `;
        
        // Add event listeners to buttons
        const connectBtn = li.querySelector('.connect-btn');
        const disconnectBtn = li.querySelector('.disconnect-btn');
        const editBtn = li.querySelector('.edit-btn');
        const deleteBtn = li.querySelector('.delete-btn');
        
        if (connectBtn) {
            connectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                connectToMqtt(connection.id);
            });
        }
        
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                disconnectConnection(connection.id);
            });
        }
        
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editConnection(connection.id);
        });
        
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConnection(connection.id);
        });
        
        // Click on connection item to make it active (only if connected)
        li.addEventListener('click', (e) => {
            if (connection.connected) {
                activeConnection = connection;
                updateConnectionIndicator();
                renderConnections();
                renderTree();
                clearMessagePanel();
                showToast(`Switched to viewing ${connection.name}`, 'info');
            }
        });
        
        connectionList.appendChild(li);
    });
}

function saveConnections() {
    const connectionsToSave = {};
    Object.keys(connections).forEach(id => {
        const conn = connections[id];
        connectionsToSave[id] = {
            id: conn.id, name: conn.name, url: conn.url,
            clientId: conn.clientId, username: conn.username, password: conn.password,
            subscriptionTopics: conn.subscriptionTopics || ['#'],
            topicTree: conn.topicTree || {}
        };
    });
    localStorage.setItem('mqttConnections', JSON.stringify(connectionsToSave));
}

function loadConnections() {
    const saved = localStorage.getItem('mqttConnections');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.keys(parsed).forEach(id => {
                const conn = parsed[id];
                connections[id] = {
                    ...conn, client: null, connected: false, hasError: false,
                    topicTree: conn.topicTree || {},
                    subscriptionTopics: conn.subscriptionTopics || ['#'],
                    clientId: conn.clientId || generateClientId()
                };
            });
            renderConnections();
        } catch (e) {
            console.error('Error loading saved connections:', e);
        }
    }
}

function updateTreeStructure(connection, topic, message) {
    if (!connection) return;
    
    const parts = topic.split('/');
    let current = connection.topicTree;
    
    // Navigate/create the tree structure
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
        
        // If this is the last part (the actual topic), add the message
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
    
    saveConnections();
}

function countTopicsAndMessages(node) {
    let topicCount = 0;
    let messageCount = 0;
    
    for (const [key, value] of Object.entries(node)) {
        // If this node has messages, it's a topic
        if (value.messages && value.messages.length > 0) {
            topicCount++;
            messageCount += value.messages.length;
        }
        
        // Recursively count children
        if (Object.keys(value.children).length > 0) {
            const childCounts = countTopicsAndMessages(value.children);
            topicCount += childCounts.topics;
            messageCount += childCounts.messages;
        }
    }
    
    return { topics: topicCount, messages: messageCount };
}

function renderTree() {
    // Update tree header to show active connection
    const treeHeader = document.querySelector('.tree-header');
    if (activeConnection) {
        treeHeader.className = 'tree-header has-active-connection';
        treeHeader.innerHTML = `
            Topic Tree
            <div class="active-connection-name">Viewing: ${activeConnection.name}</div>
        `;
    } else {
        treeHeader.className = 'tree-header';
        treeHeader.innerHTML = 'Topic Tree';
    }
    
    treeView.innerHTML = '';
    if (activeConnection && activeConnection.topicTree) {
        renderNode(activeConnection.topicTree, treeView, 0);
    }
}

function renderNode(node, container, level) {
    for (const [key, value] of Object.entries(node)) {
        const nodeElement = document.createElement('li');
        nodeElement.className = 'tree-node';
        
        const headerElement = document.createElement('div');
        headerElement.className = 'tree-node-header';
        
        const hasChildren = Object.keys(value.children).length > 0;
        const hasMessages = value.messages && value.messages.length > 0;
        
        if (hasMessages) {
            headerElement.classList.add('has-messages');
        }
        
        if (selectedTopic === value.fullTopic && hasMessages) {
            headerElement.classList.add('selected');
        }
        
        // Add expand/collapse icon
        const iconElement = document.createElement('span');
        iconElement.className = 'tree-expand-icon';
        if (hasChildren) {
            iconElement.textContent = value.isExpanded ? '▼' : '▶';
            iconElement.style.cursor = 'pointer';
        }
        headerElement.appendChild(iconElement);
        
        // Add node name
        const nameElement = document.createElement('span');
        nameElement.className = 'tree-node-name';
        nameElement.textContent = key;
        headerElement.appendChild(nameElement);
        
        // Add topic/message counts and current value
        const infoElement = document.createElement('span');
        infoElement.className = 'tree-node-value';
        
        let infoHTML = '';
        
        if (hasChildren) {
            // Show count of subtopics and messages
            const counts = countTopicsAndMessages(value.children);
            const parts = [];
            if (counts.topics > 0) parts.push(`${counts.topics} topic${counts.topics !== 1 ? 's' : ''}`);
            if (counts.messages > 0) parts.push(`${counts.messages} message${counts.messages !== 1 ? 's' : ''}`);
            infoHTML = parts.join(', ');
        }
        
        // Add current topic's message info if it has messages
        if (hasMessages) {
            const currentInfo = `${value.messages.length} msg${value.messages.length !== 1 ? 's' : ''}`;
            const messagePayload = `<span class="message-payload">${escapeHtml(value.messages[0].value)}</span>`;
            
            if (infoHTML) {
                infoHTML += ` | ${currentInfo}: ${messagePayload}`;
            } else {
                infoHTML = `${currentInfo}: ${messagePayload}`;
            }
        }
        
        infoElement.innerHTML = infoHTML;
        headerElement.appendChild(infoElement);
        
        nodeElement.appendChild(headerElement);
        
        // Click handlers
        iconElement.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hasChildren) {
                value.isExpanded = !value.isExpanded;
                saveConnections();
                renderTree();
            }
        });
        
        nameElement.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hasMessages) {
                selectedTopic = value.fullTopic;
                renderTree();
                showTopicMessages(value.fullTopic);
            } else if (hasChildren) {
                value.isExpanded = !value.isExpanded;
                saveConnections();
                renderTree();
            }
        });
        
        // Render children if expanded
        if (value.isExpanded && hasChildren) {
            const childContainer = document.createElement('ul');
            childContainer.className = 'tree-children';
            renderNode(value.children, childContainer, level + 1);
            nodeElement.appendChild(childContainer);
        }
        
        container.appendChild(nodeElement);
    }
}

function clearSelection() {
    selectedTopic = null;
    renderTree();
    clearMessagePanel();
}

function showTopicMessages(topic) {
    if (!activeConnection || !topic) return;
    
    const topicData = findTopicInTree(activeConnection.topicTree, topic);
    if (!topicData || !topicData.messages) {
        clearMessagePanel();
        return;
    }
    
    const messages = topicData.messages;
    
    messageDetails.innerHTML = `
        <div class="topic-info">
            <div class="topic-path">${escapeHtml(topic)}</div>
            <div style="margin-top: 5px; font-size: 14px; color: #6c757d;">
                ${messages.length} message${messages.length !== 1 ? 's' : ''}
            </div>
        </div>
        <div class="message-log">
            ${messages.map(msg => `
                <div class="message-item">
                    <div class="message-timestamp">${new Date(msg.timestamp).toLocaleString()}</div>
                    <div class="message-value">${escapeHtml(msg.value)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function findTopicInTree(node, targetTopic) {
    for (const [key, value] of Object.entries(node)) {
        if (value.fullTopic === targetTopic) {
            return value;
        }
        
        if (Object.keys(value.children).length > 0) {
            const found = findTopicInTree(value.children, targetTopic);
            if (found) return found;
        }
    }
    return null;
}

function clearMessagePanel() {
    selectedTopic = null;
    messageDetails.innerHTML = '<div class="no-topic-selected">Select a topic from the tree to view message history</div>';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}