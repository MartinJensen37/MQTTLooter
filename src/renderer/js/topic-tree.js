const EventEmitter = require('events');
const { escapeHtml } = require('./utils');
const DatabaseManager = require('./database-manager');

class TopicTree extends EventEmitter {
    constructor() {
        super();
        this.treeView = document.getElementById('tree-view');
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.dbManager = null;
        this.isInitialized = false;
        this.treeStructure = {}; // Lightweight tree structure with counts only
        this.renderPending = false; // Add render throttling
        this.updateThrottle = new Map(); // Throttle updates per topic
        this.setupEventHandlers();
        this.initDatabase();
    }

    async initDatabase() {
        try {
            console.log('TopicTree: Initializing database...');
            this.dbManager = new DatabaseManager();
            await this.dbManager.init();
            this.isInitialized = true;
            console.log('TopicTree: Database initialized successfully');
            this.emit('database-ready');
        } catch (error) {
            console.error('TopicTree: Database initialization failed:', error);
            this.isInitialized = false;
        }
    }

    setupEventHandlers() {
        this.treeView.addEventListener('click', (e) => {
            if (e.target === this.treeView) {
                this.clearSelection();
            }
        });
    }

    async updateTopic(connectionId, topic, message) {
        // Throttle updates per topic to prevent spam
        const throttleKey = `${connectionId}:${topic}`;
        if (this.updateThrottle.has(throttleKey)) {
            clearTimeout(this.updateThrottle.get(throttleKey));
        }
        
        this.updateThrottle.set(throttleKey, setTimeout(async () => {
            await this.performTopicUpdate(connectionId, topic, message);
            this.updateThrottle.delete(throttleKey);
        }, 100)); // 100ms throttle
    }

    async performTopicUpdate(connectionId, topic, message) {
        // Wait for database to be ready
        if (!this.isInitialized) {
            await new Promise((resolve) => {
                if (this.isInitialized) {
                    resolve();
                } else {
                    this.once('database-ready', resolve);
                }
            });
        }
        
        try {
            // Store message in IndexedDB
            await this.dbManager.addMessage(connectionId, topic, message);
            
            // Update lightweight tree structure
            await this.updateTreeStructure(connectionId, topic);
            
            // Only update if this is for the current active connection
            if (this.currentActiveConnection && this.currentActiveConnection.id === connectionId) {
                // SMART UPDATE: Only update the specific node instead of full re-render
                this.updateTopicNodeDisplay(topic, message);
                
                // If the selected topic matches the updated topic, emit event
                if (this.selectedTopic === topic) {
                    this.emit('topic-selected', topic);
                }
            }
        } catch (error) {
            console.error('TopicTree: Error updating topic:', error);
        }
    }

    // NEW METHOD: Update only the specific topic node instead of full re-render
    updateTopicNodeDisplay(topic, message) {
        if (!this.currentActiveConnection) return;
        
        const connectionId = this.currentActiveConnection.id;
        const nodeData = this.findNodeData(this.treeStructure[connectionId], topic);
        if (!nodeData) return;
        
        // Find the DOM element for this topic
        const topicElement = this.findTopicDOMElement(topic);
        if (topicElement) {
            this.updateSingleNodeInfo(topicElement, nodeData, message);
        }
    }

    // NEW METHOD: Find the DOM element for a specific topic
    findTopicDOMElement(topic) {
        const headers = this.treeView.querySelectorAll('.tree-node-header');
        for (const header of headers) {
            if (this.getTopicPathFromElement(header) === topic) {
                return header;
            }
        }
        return null;
    }

    // NEW METHOD: Get topic path from DOM element
    getTopicPathFromElement(headerElement) {
        const pathParts = [];
        let currentElement = headerElement;
        
        while (currentElement && currentElement.classList.contains('tree-node-header')) {
            const nameElement = currentElement.querySelector('.tree-node-name');
            if (nameElement) {
                pathParts.unshift(nameElement.textContent);
            }
            
            // Move up to parent tree node
            const parentNode = currentElement.closest('.tree-node').parentElement;
            if (parentNode && parentNode.classList.contains('tree-children')) {
                const grandParent = parentNode.parentElement;
                if (grandParent && grandParent.classList.contains('tree-node')) {
                    currentElement = grandParent.querySelector('.tree-node-header');
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        
        return pathParts.join('/');
    }

    // NEW METHOD: Update just the info for a single node
    updateSingleNodeInfo(headerElement, nodeData, message) {
        const valueElement = headerElement.querySelector('.tree-node-value');
        if (!valueElement) return;
        
        const hasChildren = Object.keys(nodeData.children || {}).length > 0;
        const hasMessages = nodeData.fullTopic && nodeData.messageCount > 0;
        
        let infoHTML = '';
        
        if (hasChildren) {
            const parts = [];
            if (nodeData.topicCount > 0) parts.push(`${nodeData.topicCount} topic${nodeData.topicCount !== 1 ? 's' : ''}`);
            if (nodeData.messageCount > 0) parts.push(`${nodeData.messageCount} message${nodeData.messageCount !== 1 ? 's' : ''}`);
            infoHTML = parts.join(', ');
        }
        
        // Add current topic's message info if it has messages
        if (hasMessages) {
            const currentInfo = `${nodeData.messageCount} msg${nodeData.messageCount !== 1 ? 's' : ''}`;
            const messagePayload = message ? 
                `<span class="message-payload">${escapeHtml(message)}</span>` : '';
            
            if (infoHTML) {
                infoHTML += ` | ${currentInfo}${messagePayload ? ': ' + messagePayload : ''}`;
            } else {
                infoHTML = `${currentInfo}${messagePayload ? ': ' + messagePayload : ''}`;
            }
        }
        
        valueElement.innerHTML = infoHTML;
        
        // Add visual feedback for updated nodes
        headerElement.classList.add('node-updated');
        setTimeout(() => {
            headerElement.classList.remove('node-updated');
        }, 1000);
    }

    // NEW METHOD: Find node data in tree structure
    findNodeData(treeData, topic) {
        if (!treeData) return null;
        
        const parts = topic.split('/');
        let current = treeData;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!current[part]) return null;
            
            if (i === parts.length - 1) {
                return current[part]; // This is the final node
            }
            current = current[part].children;
        }
        
        return null;
    }

    // Modified: Only do full render when explicitly needed
    scheduleRender() {
        if (this.renderPending) return;
        
        this.renderPending = true;
        requestAnimationFrame(async () => {
            await this.render(this.currentActiveConnection);
            this.renderPending = false;
        });
    }

    async updateTreeStructure(connectionId, topic) {
        if (!this.treeStructure[connectionId]) {
            this.treeStructure[connectionId] = {};
        }

        const parts = topic.split('/');
        let current = this.treeStructure[connectionId];
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            if (!current[part]) {
                current[part] = {
                    children: {},
                    isExpanded: true,
                    fullTopic: null,
                    messageCount: 0,
                    topicCount: 0
                };
            }
            
            if (i === parts.length - 1) {
                // This is the final topic node
                current[part].fullTopic = topic;
                const metadata = await this.dbManager.getTopicMetadata(`${connectionId}:${topic}`);
                if (metadata) {
                    current[part].messageCount = metadata.messageCount;
                    current[part].lastMessage = metadata.lastMessage;
                }
            }
            
            current = current[part].children;
        }
        
        // Update counts up the tree
        this.updateCounts(this.treeStructure[connectionId]);
    }

    updateCounts(node) {
        for (const [key, value] of Object.entries(node)) {
            let childTopicCount = 0;
            let childMessageCount = 0;
            
            if (Object.keys(value.children).length > 0) {
                this.updateCounts(value.children);
                
                // Sum up children counts
                for (const child of Object.values(value.children)) {
                    if (child.fullTopic) {
                        childTopicCount++;
                        childMessageCount += child.messageCount || 0;
                    }
                    childTopicCount += child.topicCount || 0;
                    childMessageCount += child.messageCount || 0;
                }
            }
            
            value.topicCount = childTopicCount;
            if (!value.fullTopic) {
                value.messageCount = childMessageCount;
            }
        }
    }

    async render(activeConnection = null) {
        this.currentActiveConnection = activeConnection;
        
        if (!activeConnection || (this.selectedTopic && this.currentActiveConnection && this.currentActiveConnection.id !== activeConnection.id)) {
            this.selectedTopic = null;
        }
        
        this.updateTreeHeader(activeConnection);
        await this.renderTreeNodes(activeConnection);
    }

    updateTreeHeader(activeConnection) {
        const treeHeader = document.querySelector('.tree-header');
        if (!treeHeader) {
            console.warn('TopicTree: .tree-header element not found');
            return;
        }

        if (activeConnection) {
            treeHeader.className = 'tree-header has-active-connection';
            treeHeader.innerHTML = `
                Topic Tree
                <div class="active-connection-name">Viewing: ${escapeHtml(activeConnection.name)}</div>
            `;
        } else {
            treeHeader.className = 'tree-header';
            treeHeader.innerHTML = 'Topic Tree';
        }
    }

    async renderTreeNodes(activeConnection) {
        if (!this.treeView) {
            console.error('TopicTree: tree-view element not found');
            return;
        }
        
        this.treeView.innerHTML = '';
        
        if (!activeConnection) {
            this.showEmptyState('No active connection');
            return;
        }
        
        if (!activeConnection.connected) {
            this.showEmptyState('No active connection');
            return;
        }
        
        const treeData = this.treeStructure[activeConnection.id];
        
        if (!treeData || Object.keys(treeData).length === 0) {
            this.showWaitingState();
            return;
        }
        
        // Only render visible (expanded) nodes
        await this.renderVisibleNodes(treeData, this.treeView, 0);
    }

    showEmptyState(message) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'no-topic-selected';
        emptyMessage.style.cssText = 'text-align: center; padding: 20px; color: #6c757d; font-style: italic;';
        emptyMessage.textContent = message;
        this.treeView.appendChild(emptyMessage);
    }

    showWaitingState() {
        const waitingMessage = document.createElement('div');
        waitingMessage.className = 'no-topic-selected';
        waitingMessage.style.cssText = 'text-align: center; padding: 20px; color: #6c757d; font-style: italic;';
        waitingMessage.innerHTML = `
            <div style="color: #2ecc71; margin-bottom: 10px;">Connected</div>
            <div style="font-size: 14px;">Waiting for MQTT messages...</div>
        `;
        this.treeView.appendChild(waitingMessage);
    }

    async renderVisibleNodes(node, container, level) {
        if (!node) return;
        
        for (const [key, value] of Object.entries(node)) {
            const nodeElement = document.createElement('li');
            nodeElement.className = 'tree-node';
            
            const headerElement = document.createElement('div');
            headerElement.className = 'tree-node-header';
            
            const hasChildren = Object.keys(value.children).length > 0;
            const hasMessages = value.fullTopic && value.messageCount > 0;
            
            if (hasMessages) {
                headerElement.classList.add('has-messages');
            }
            
            if (this.selectedTopic === value.fullTopic && hasMessages) {
                headerElement.classList.add('selected');
            }
            
            // Add expand/collapse icon
            const iconElement = document.createElement('span');
            iconElement.className = 'tree-expand-icon';
            if (hasChildren) {
                iconElement.textContent = value.isExpanded ? '▼' : '▶';
                iconElement.style.cursor = 'pointer';
            } else {
                iconElement.innerHTML = '&nbsp;';
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
                const parts = [];
                if (value.topicCount > 0) parts.push(`${value.topicCount} topic${value.topicCount !== 1 ? 's' : ''}`);
                if (value.messageCount > 0) parts.push(`${value.messageCount} message${value.messageCount !== 1 ? 's' : ''}`);
                infoHTML = parts.join(', ');
            }
            
            // Add current topic's message info if it has messages
            if (hasMessages) {
                const currentInfo = `${value.messageCount} msg${value.messageCount !== 1 ? 's' : ''}`;
                const messagePayload = value.lastMessage ? 
                    `<span class="message-payload">${escapeHtml(value.lastMessage)}</span>` : '';
                
                if (infoHTML) {
                    infoHTML += ` | ${currentInfo}${messagePayload ? ': ' + messagePayload : ''}`;
                } else {
                    infoHTML = `${currentInfo}${messagePayload ? ': ' + messagePayload : ''}`;
                }
            }
            
            infoElement.innerHTML = infoHTML;
            headerElement.appendChild(infoElement);
            
            nodeElement.appendChild(headerElement);
            
            // Click handlers
            iconElement.addEventListener('click', (e) => {
                e.stopPropagation();
                if (hasChildren) {
                    this.toggleNodeExpansion(value, key);
                }
            });
            
            nameElement.addEventListener('click', (e) => {
                e.stopPropagation();
                if (hasMessages) {
                    this.selectTopic(value.fullTopic);
                } else if (hasChildren) {
                    this.toggleNodeExpansion(value, key);
                }
            });
            
            // Only render children if expanded (lazy rendering)
            if (value.isExpanded && hasChildren) {
                const childContainer = document.createElement('ul');
                childContainer.className = 'tree-children';
                await this.renderVisibleNodes(value.children, childContainer, level + 1);
                nodeElement.appendChild(childContainer);
            }
            
            container.appendChild(nodeElement);
        }
    }

    toggleNodeExpansion(node, nodeKey) {
        node.isExpanded = !node.isExpanded;
        this.emit('node-toggled', { node, nodeKey });
        // Re-render only the affected part of the tree
        this.scheduleRender();
    }

    selectTopic(topic) {
        this.selectedTopic = topic;
        this.scheduleRender();
        this.emit('topic-selected', topic);
    }

    clearSelection() {
        this.selectedTopic = null;
        this.scheduleRender();
        this.emit('selection-cleared');
    }

    clear() {
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.treeView.innerHTML = '';
        
        // Clear throttle timers
        this.updateThrottle.forEach(timer => clearTimeout(timer));
        this.updateThrottle.clear();
        
        const treeHeader = document.querySelector('.tree-header');
        if (treeHeader) {
            treeHeader.className = 'tree-header';
            treeHeader.innerHTML = 'Topic Tree';
        }
    }

    async getTopicMessages(connectionId, topic, limit = 100, offset = 0) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }
        return await this.dbManager.getTopicMessages(connectionId, topic, limit, offset);
    }

    getSelectedTopic() {
        return this.selectedTopic;
    }

    async clearConnectionData(connectionId) {
        await this.dbManager.clearConnectionData(connectionId);
        delete this.treeStructure[connectionId];
        if (this.currentActiveConnection && this.currentActiveConnection.id === connectionId) {
            this.scheduleRender();
        }
    }
}

module.exports = TopicTree;