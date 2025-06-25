const EventEmitter = require('events');
const { generateClientId } = require('./utils');

class ModalManager extends EventEmitter {
    constructor() {
        super();
        this.connectionModal = document.getElementById('connection-modal');
        this.modalTitle = document.getElementById('modal-title');
        this.modalClose = document.getElementById('modal-close');
        this.modalCancel = document.getElementById('modal-cancel');
        this.connectionForm = document.getElementById('connection-form');
        this.addSubscriptionBtn = document.getElementById('add-subscription-btn');
        
        // Form elements
        this.connectionNameInput = document.getElementById('connection-name');
        this.protocolSelect = document.getElementById('protocol-select');
        this.brokerHostInput = document.getElementById('broker-host');
        this.brokerPortInput = document.getElementById('broker-port');
        this.clientIdInput = document.getElementById('client-id');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.subscriptionList = document.getElementById('subscription-list');
        
        this.editingConnectionId = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.modalClose.addEventListener('click', () => this.closeModal());
        this.modalCancel.addEventListener('click', () => this.closeModal());
        this.connectionForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        this.addSubscriptionBtn.addEventListener('click', () => this.addSubscriptionField());

        // Protocol change listener
        this.protocolSelect.addEventListener('change', () => {
            const currentPort = this.brokerPortInput.value;
            const defaultPort = this.getDefaultPort(this.protocolSelect.value);
            
            // Only update port if it's empty or matches a default port
            if (!currentPort || 
                currentPort === '1883' || 
                currentPort === '8883' || 
                currentPort === '8080' ||
                currentPort === '80' ||
                currentPort === '443') {
                this.brokerPortInput.value = defaultPort;
            }
        });

        // Close modal when clicking outside
        this.connectionModal.addEventListener('click', (e) => {
            if (e.target === this.connectionModal) {
                this.closeModal();
            }
        });

        // ESC key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.connectionModal.style.display === 'block') {
                this.closeModal();
            }
        });
    }

    showConnectionModal(connectionId = null) {
        this.editingConnectionId = connectionId;
        this.clearForm();
        
        if (connectionId) {
            this.modalTitle.textContent = 'Edit Connection';
            this.emit('request-connection-data', connectionId);
        } else {
            this.modalTitle.textContent = 'Add Connection';
        }
        
        this.connectionModal.style.display = 'block';
        
        // Focus on the connection name input
        setTimeout(() => {
            this.connectionNameInput.focus();
            if (connectionId) {
                this.connectionNameInput.select();
            }
        }, 100);
    }

    populateForm(connection) {
        try {
            this.connectionNameInput.value = connection.name || '';
            
            if (connection.url) {
                try {
                    const url = new URL(connection.url);
                    this.protocolSelect.value = url.protocol.replace(':', '') || 'mqtt';
                    this.brokerHostInput.value = url.hostname || '';
                    this.brokerPortInput.value = url.port || this.getDefaultPort(url.protocol.replace(':', ''));
                } catch (e) {
                    console.error('Error parsing connection URL:', e);
                    const urlParts = connection.url.split('://');
                    if (urlParts.length === 2) {
                        this.protocolSelect.value = urlParts[0] || 'mqtt';
                        const hostPort = urlParts[1].split(':');
                        this.brokerHostInput.value = hostPort[0] || '';
                        this.brokerPortInput.value = hostPort[1] || this.getDefaultPort(urlParts[0]);
                    }
                }
            } else {
                this.protocolSelect.value = 'mqtt';
                this.brokerHostInput.value = '';
                this.brokerPortInput.value = this.getDefaultPort('mqtt');
            }
            
            this.clientIdInput.value = connection.clientId || generateClientId();
            this.usernameInput.value = connection.username || '';
            this.passwordInput.value = connection.password || '';
            
            // Populate subscription topics
            this.subscriptionList.innerHTML = '';
            const topics = connection.subscriptionTopics || ['#'];
            if (topics.length === 0) topics.push('#');
            
            topics.forEach(topic => this.addSubscriptionField(topic));
        } catch (error) {
            console.error('Error populating form:', error);
        }
    }

    closeModal() {
        this.connectionModal.style.display = 'none';
        this.editingConnectionId = null;
        this.clearForm();
    }

    clearForm() {
        this.connectionNameInput.value = '';
        this.protocolSelect.value = 'mqtt';
        this.brokerHostInput.value = '';
        this.brokerPortInput.value = this.getDefaultPort('mqtt');
        this.clientIdInput.value = generateClientId();
        this.usernameInput.value = '';
        this.passwordInput.value = '';
        
        this.subscriptionList.innerHTML = '';
        this.addSubscriptionField('#');
    }

    getDefaultPort(protocol) {
        const defaultPorts = {
            'mqtt': '1883',
            'mqtts': '8883',
            'ws': '8080',
            'wss': '443'
        };
        return defaultPorts[protocol] || '1883';
    }

    addSubscriptionField(value = '') {
        const div = document.createElement('div');
        div.className = 'subscription-item';
        
        div.innerHTML = `
            <input type="text" class="form-input subscription-input" 
                   value="${value}" placeholder="e.g., sensors/+/temperature">
            <button type="button" class="remove-subscription-btn">Remove</button>
        `;
        
        const removeBtn = div.querySelector('.remove-subscription-btn');
        removeBtn.addEventListener('click', () => this.removeSubscription(removeBtn));
        
        this.subscriptionList.appendChild(div);
    }

    removeSubscription(button) {
        const subscriptionItem = button.closest('.subscription-item');
        if (subscriptionItem && this.subscriptionList.children.length > 1) {
            this.subscriptionList.removeChild(subscriptionItem);
        }
    }

    getSubscriptionTopics() {
        const inputs = this.subscriptionList.querySelectorAll('.subscription-input');
        const topics = Array.from(inputs)
            .map(input => input.value.trim())
            .filter(topic => topic.length > 0);
        
        return topics.length > 0 ? topics : ['#'];
    }

    handleFormSubmit(e) {
        e.preventDefault();
        
        try {
            const name = this.connectionNameInput.value.trim();
            const protocol = this.protocolSelect.value;
            const host = this.brokerHostInput.value.trim();
            const port = this.brokerPortInput.value.trim();
            const clientId = this.clientIdInput.value.trim();
            const username = this.usernameInput.value.trim();
            const password = this.passwordInput.value.trim();
            const subscriptionTopics = this.getSubscriptionTopics();
            
            if (!name || !host || !port) {
                this.emit('form-error', 'Please provide connection name, host, and port');
                return;
            }
            
            const portNum = parseInt(port);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                this.emit('form-error', 'Please provide a valid port number (1-65535)');
                return;
            }
            
            const url = `${protocol}://${host}:${port}`;
            
            const connectionData = {
                name,
                url,
                clientId: clientId || generateClientId(),
                username: username || null,
                password: password || null,
                subscriptionTopics
            };
            
            if (this.editingConnectionId) {
                this.emit('connection-updated', this.editingConnectionId, connectionData);
            } else {
                this.emit('connection-added', connectionData);
            }
            
            this.closeModal();
        } catch (error) {
            console.error('Error handling form submit:', error);
            this.emit('form-error', 'Error saving connection');
        }
    }
}

module.exports = ModalManager;