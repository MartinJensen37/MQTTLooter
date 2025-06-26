const EventEmitter = require('events');
const path = require('path');
const { escapeHtml } = require(path.join(__dirname, 'utils.js'));
const DatabaseManager = require(path.join(__dirname, 'database-manager.js'));

class TopicTree extends EventEmitter {
    constructor() {
        super();
        this.dbManager = null; // Will be initialized when needed
        this.treeStructure = {};
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.renderScheduled = false;
        this.isInitialized = false;
        
        // Single source of truth for message counts
        this.messageCounts = {}; // connectionId:topic -> count
        
        // Track known topics to detect new ones
        this.knownTopics = new Set();
        
        // Simple throttling for rendering
        this.renderThrottle = null;
        
        // Don't initialize immediately - wait for first use
    }

    async initDatabase() {
        try {
            console.log('TopicTree: Initializing database...');
            this.dbManager = new DatabaseManager();
            await this.dbManager.init(); // Use the correct method name
            this.isInitialized = true;
            console.log('TopicTree: Database initialized successfully');
            this.emit('database-ready');
        } catch (error) {
            console.error('TopicTree: Database initialization failed:', error);
            this.isInitialized = false;
        }
    }

    // Single method to get message count (used by both TopicTree and MessagePanel)
    getTopicMessageCount(connectionId, topic) {
        const key = `${connectionId}:${topic}`;
        return this.messageCounts[key] || 0;
    }

    // Single method to update message count
    updateTopicMessageCount(connectionId, topic, newCount) {
        const key = `${connectionId}:${topic}`;
        const oldCount = this.messageCounts[key] || 0;
        
        if (newCount !== oldCount) {
            this.messageCounts[key] = newCount;
            this.updateTopicInStructure(connectionId, topic, newCount);
            this.scheduleRender();
        }
    }

    // Increment message count (for real-time updates)
    incrementTopicMessageCount(connectionId, topic) {
        const key = `${connectionId}:${topic}`;
        const currentCount = this.messageCounts[key] || 0;
        this.updateTopicMessageCount(connectionId, topic, currentCount + 1);
    }

    // This is the method that ConnectionManager expects to exist
    async updateTopic(connectionId, topic, message) {
        // Initialize database if not already done
        if (!this.isInitialized) {
            if (!this.dbManager) {
                await this.initDatabase();
            }
        }

        if (!this.isInitialized) {
            console.warn('TopicTree: Database still not initialized, skipping update');
            return;
        }

        try {
            // Store message in database
            await this.dbManager.addMessage(connectionId, topic, message);
            
            // Update local counts
            await this.handleNewMessage(connectionId, topic, message);
        } catch (error) {
            console.error('TopicTree: Error updating topic:', error);
        }
    }

    // Handle new messages - simplified
    async handleNewMessage(connectionId, topic, message) {
        if (!this.isInitialized) return;

        const topicKey = `${connectionId}:${topic}`;
        const isNewTopic = !this.knownTopics.has(topicKey);
        
        if (isNewTopic) {
            console.log('TopicTree: New topic discovered:', topic);
            this.knownTopics.add(topicKey);
            
            // For new topics, start with count of 1
            this.updateTopicMessageCount(connectionId, topic, 1);
        } else {
            // For existing topics, just increment
            this.incrementTopicMessageCount(connectionId, topic);
        }
    }

    // Update topic in tree structure
    updateTopicInStructure(connectionId, topic, messageCount) {
        if (!this.treeStructure[connectionId]) {
            this.treeStructure[connectionId] = {};
        }

        const parts = topic.split('/');
        let current = this.treeStructure[connectionId];

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            if (!current[part]) {
                current[part] = {
                    messageCount: 0,
                    lastUpdate: Date.now(),
                    children: {}
                };
            }

            // If this is the final part (the actual topic), update its data
            if (i === parts.length - 1) {
                current[part].messageCount = messageCount;
                current[part].lastUpdate = Date.now();
            }

            current = current[part].children;
        }
    }

    // Throttled render scheduling
    scheduleRender() {
        if (this.renderThrottle) {
            clearTimeout(this.renderThrottle);
        }
        
        this.renderThrottle = setTimeout(() => {
            this.render();
            this.renderThrottle = null;
        }, 100); // Simple 100ms throttle
    }

    async loadTreeStructure(connectionId) {
        if (!this.isInitialized) {
            console.warn('TopicTree: Database not initialized yet');
            // Try to initialize
            if (!this.dbManager) {
                await this.initDatabase();
            }
            if (!this.isInitialized) {
                return;
            }
        }

        try {
            console.log('TopicTree: Loading tree structure for connection:', connectionId);
            
            const topics = await this.dbManager.getAllTopics(connectionId);
            console.log('TopicTree: Found topics:', topics.length);
            
            // Clear existing structure for this connection
            this.treeStructure[connectionId] = {};
            
            // Load all topic counts and build structure
            for (const topicData of topics) {
                const topic = topicData.topic;
                const count = topicData.messageCount || 0;
                
                // Update our single source of truth
                const key = `${connectionId}:${topic}`;
                this.messageCounts[key] = count;
                this.knownTopics.add(key);
                
                // Build tree structure
                this.updateTopicInStructure(connectionId, topic, count);
            }
            
            this.render();
            
        } catch (error) {
            console.error('TopicTree: Error loading tree structure:', error);
        }
    }

    render(connection = null) {
        if (connection) {
            this.currentActiveConnection = connection;
        }

        if (!this.currentActiveConnection) {
            this.clearTreeView();
            return;
        }

        const connectionId = this.currentActiveConnection.id;
        const treeData = this.treeStructure[connectionId];
        
        if (!treeData || Object.keys(treeData).length === 0) {
            this.showLoadingState();
            // Load data if we don't have it
            this.loadTreeStructure(connectionId);
            return;
        }

        this.renderTreeStructure(treeData);
        this.updateTreeHeader();
    }

    // Add the missing forceUpdate method
    forceUpdate() {
        console.log('TopicTree: Force update requested');
        if (this.currentActiveConnection) {
            this.scheduleRender();
        }
    }

    renderTreeStructure(treeData, parentElement = null, path = '') {
        const container = parentElement || document.getElementById('tree-view');
        if (!container) return;

        if (!parentElement) {
            container.innerHTML = '';
        }

        Object.keys(treeData).sort().forEach(key => {
            const nodeData = treeData[key];
            const fullPath = path ? `${path}/${key}` : key;
            const hasChildren = nodeData.children && Object.keys(nodeData.children).length > 0;
            const messageCount = nodeData.messageCount || 0;

            const li = document.createElement('li');
            li.className = 'tree-node';
            
            const nodeContent = document.createElement('div');
            nodeContent.className = 'tree-node-content';
            
            if (hasChildren) {
                const toggleBtn = document.createElement('span');
                toggleBtn.className = 'tree-toggle';
                toggleBtn.textContent = '▶';
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleNode(li);
                };
                nodeContent.appendChild(toggleBtn);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'tree-spacer';
                nodeContent.appendChild(spacer);
            }

            const label = document.createElement('span');
            label.className = 'tree-label';
            label.textContent = key;
            
            if (!hasChildren) {
                label.classList.add('selectable');
                label.onclick = () => this.selectTopic(fullPath);
                
                if (this.selectedTopic === fullPath) {
                    label.classList.add('selected');
                }
            }
            
            nodeContent.appendChild(label);

            if (messageCount > 0) {
                const countBadge = document.createElement('span');
                countBadge.className = 'message-count';
                countBadge.textContent = messageCount.toString();
                nodeContent.appendChild(countBadge);
            }

            li.appendChild(nodeContent);

            if (hasChildren) {
                const childList = document.createElement('ul');
                childList.className = 'tree-children';
                childList.style.display = 'none';
                this.renderTreeStructure(nodeData.children, childList, fullPath);
                li.appendChild(childList);
            }

            container.appendChild(li);
        });
    }

    toggleNode(nodeElement) {
        const toggle = nodeElement.querySelector('.tree-toggle');
        const children = nodeElement.querySelector('.tree-children');
        
        if (!children) return;

        const isExpanded = children.style.display !== 'none';
        children.style.display = isExpanded ? 'none' : 'block';
        toggle.textContent = isExpanded ? '▶' : '▼';
        
        if (!isExpanded) {
            nodeElement.classList.add('expanded');
        } else {
            nodeElement.classList.remove('expanded');
        }
    }

    selectTopic(topic) {
        // Clear previous selection
        const prevSelected = document.querySelector('.tree-label.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }

        // Set new selection
        this.selectedTopic = topic;
        const newSelected = Array.from(document.querySelectorAll('.tree-label.selectable'))
            .find(label => {
                const li = label.closest('li');
                return this.getFullPathForElement(li) === topic;
            });

        if (newSelected) {
            newSelected.classList.add('selected');
        }

        console.log('TopicTree: Topic selected:', topic);
        this.emit('topic-selected', topic);
    }

    getFullPathForElement(element) {
        const parts = [];
        let current = element;
        
        while (current && current.classList.contains('tree-node')) {
            const label = current.querySelector('.tree-label');
            if (label) {
                parts.unshift(label.textContent);
            }
            current = current.parentElement?.closest?.('.tree-node');
        }
        
        return parts.join('/');
    }

    clearTreeView() {
        const treeView = document.getElementById('tree-view');
        if (treeView) {
            treeView.innerHTML = '<li class="no-connection">No active connection</li>';
        }
        
        const treeHeader = document.querySelector('.tree-header');
        if (treeHeader) {
            treeHeader.textContent = 'Topic Tree';
        }
    }

    showLoadingState() {
        const treeView = document.getElementById('tree-view');
        if (treeView) {
            treeView.innerHTML = '<li class="loading">Loading topics...</li>';
        }
    }

    updateTreeHeader() {
        const treeHeader = document.querySelector('.tree-header');
        if (treeHeader && this.currentActiveConnection) {
            const topicCount = this.knownTopics.size;
            treeHeader.innerHTML = `Topic Tree (${topicCount} topics)`;
        }
    }

    clear() {
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.treeStructure = {};
        this.messageCounts = {};
        this.knownTopics.clear();
        
        // Clear intervals and timers
        if (this.renderThrottle) {
            clearTimeout(this.renderThrottle);
            this.renderThrottle = null;
        }
        
        const treeHeader = document.querySelector('.tree-header');
        if (treeHeader) {
            treeHeader.className = 'tree-header';
            treeHeader.innerHTML = 'Topic Tree';
        }
        
        this.clearTreeView();
        
        this.emit('selection-cleared');
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
        // Only clear database if it's initialized
        if (this.isInitialized && this.dbManager) {
            try {
                await this.dbManager.clearConnectionData(connectionId);
            } catch (error) {
                console.warn('Error clearing connection data from database:', error);
            }
        }
        
        delete this.treeStructure[connectionId];
        
        // Clear message counts for this connection
        Object.keys(this.messageCounts).forEach(key => {
            if (key.startsWith(`${connectionId}:`)) {
                delete this.messageCounts[key];
            }
        });
        
        // Clear known topics for this connection
        this.knownTopics.forEach(topic => {
            if (topic.startsWith(`${connectionId}:`)) {
                this.knownTopics.delete(topic);
            }
        });
        
        if (this.currentActiveConnection && this.currentActiveConnection.id === connectionId) {
            this.scheduleRender();
        }
    }

    // Method called by ConnectionManager when messages arrive
    async onMessageReceived(connectionId, topic, message) {
        await this.handleNewMessage(connectionId, topic, message);
    }

    // Add method for compatibility with existing code
    async forceUpdate() {
        console.log('TopicTree: Force update requested');
        if (this.currentActiveConnection) {
            await this.loadTreeStructure(this.currentActiveConnection.id);
        }
    }

    // Add method for getting topic count at specific connection
    getTopicCount(connectionId) {
        return Object.keys(this.messageCounts).filter(key => 
            key.startsWith(`${connectionId}:`)
        ).length;
    }

    // Add method to check if topic exists
    hasTopicData(connectionId, topic) {
        const key = `${connectionId}:${topic}`;
        return this.knownTopics.has(key);
    }

    // Add method to get all topics for a connection
    getTopicsForConnection(connectionId) {
        return Array.from(this.knownTopics)
            .filter(key => key.startsWith(`${connectionId}:`))
            .map(key => key.substring(connectionId.length + 1));
    }

    // Add method to reset topic data
    resetTopicData(connectionId, topic) {
        const key = `${connectionId}:${topic}`;
        delete this.messageCounts[key];
        this.knownTopics.delete(key);
        
        // Remove from tree structure
        if (this.treeStructure[connectionId]) {
            this.removeTopicFromStructure(connectionId, topic);
        }
        
        this.scheduleRender();
    }

    // Helper method to remove topic from tree structure
    removeTopicFromStructure(connectionId, topic) {
        if (!this.treeStructure[connectionId]) return;

        const parts = topic.split('/');
        let current = this.treeStructure[connectionId];
        const pathNodes = [current];

        // Navigate to the topic location
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] && current[part].children) {
                current = current[part].children;
                pathNodes.push(current);
            } else {
                return; // Path doesn't exist
            }
        }

        // Remove the final topic
        const finalPart = parts[parts.length - 1];
        delete current[finalPart];

        // Clean up empty parent nodes
        for (let i = pathNodes.length - 1; i >= 0; i--) {
            const node = pathNodes[i];
            const isEmpty = Object.keys(node).length === 0;
            if (isEmpty && i > 0) {
                // Remove this empty node from its parent
                const parentPart = parts[i - 1];
                if (pathNodes[i - 1][parentPart]) {
                    delete pathNodes[i - 1][parentPart];
                }
            } else {
                break; // Stop if we find a non-empty node
            }
        }
    }
}

module.exports = TopicTree;