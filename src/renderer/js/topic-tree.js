const EventEmitter = require('events');
const path = require('path');
const { escapeHtml } = require(path.join(__dirname, 'utils.js'));
const DatabaseManager = require(path.join(__dirname, 'database-manager.js'));

class TopicTree extends EventEmitter {
    constructor() {
        super();
        this.treeView = document.getElementById('tree-view');
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.dbManager = new DatabaseManager();
        this.isInitialized = false;
        this.treeStructure = {}; // Lightweight tree structure with counts only
        this.renderPending = false; // Add render throttling
        this.updateThrottle = new Map(); // Throttle updates per topic
        
        // Single source of truth for message counts
        this.messageCounts = {}; // connectionId:topic -> count
        this.knownTopics = new Set();
        
        // REMOVED: Heavy background update intervals - only update on new topics
        this.newTopicsPending = new Set(); // Track only new topics that need tree structure updates
        
        // Message rate tracking
        this.topicRates = new Map(); // Store real-time rates per topic
        this.rateUpdateInterval = null;
        
        // DOM element cache for efficient updates
        this.domElementCache = new Map(); // topic -> DOM element mapping
        
        this.setupEventHandlers();
        this.initialize();
        this.startRateTracking();
    }

    async initialize() {
        try {
            console.log('TopicTree: Initializing database...');
            await this.dbManager.init();
            this.isInitialized = true;
            console.log('TopicTree: Database initialized successfully');
            this.emit('database-ready');
        } catch (error) {
            console.error('TopicTree: Database initialization failed:', error);
            this.isInitialized = false;
        }
    }

    startRateTracking() {
        // Track rates continuously regardless of window visibility
        this.rateUpdateInterval = setInterval(() => {
            this.updateTopicRates();
            // Update only visible DOM elements with new rates (lightweight)
            this.updateVisibleRateDisplays();
        }, 1000);
    }

    // NEW: Lightweight rate display updates for visible elements only
    updateVisibleRateDisplays() {
        if (document.hidden || !this.currentActiveConnection) return;
        
        // Only update rate displays for currently visible DOM elements
        this.domElementCache.forEach((headerElement, topic) => {
            if (headerElement && headerElement.isConnected) {
                this.updateSingleNodeRateDisplay(headerElement, topic);
            }
        });
    }

    // NEW: Update only the rate display part of a single node
    updateSingleNodeRateDisplay(headerElement, topic) {
        const valueElement = headerElement.querySelector('.tree-node-value');
        if (!valueElement) return;
        
        const currentRate = this.getTopicMessageRate(this.currentActiveConnection.id, topic);
        const currentCount = this.getTopicMessageCount(this.currentActiveConnection.id, topic);
        
        // Find the rate display span and update it
        const rateMatch = valueElement.innerHTML.match(/(\d+)\s*msg[s]?\s*(\([^)]*\))?/);
        if (rateMatch && currentRate >= 0) {
            let rateDisplay = '';
            if (currentRate > 0) {
                if (currentRate >= 1) {
                    rateDisplay = ` (${currentRate.toFixed(1)}/s)`;
                } else {
                    rateDisplay = ` (${currentRate.toFixed(2)}/s)`;
                }
            }
            
            const newInfo = `${currentCount} msg${currentCount !== 1 ? 's' : ''}${rateDisplay}`;
            valueElement.innerHTML = valueElement.innerHTML.replace(
                /\d+\s*msg[s]?\s*(\([^)]*\))?/,
                newInfo
            );
        }
    }

    updateTopicRates() {
        const now = Date.now();
        const windowSize = 10000; // 10 second window
        
        for (const [topicId, data] of this.topicRates.entries()) {
            // Remove old timestamps
            data.timestamps = data.timestamps.filter(ts => now - ts < windowSize);
            
            // Calculate rate (messages per second)
            data.rate = data.timestamps.length / (windowSize / 1000);
            
            // Update peak rate
            if (data.rate > (data.peakRate || 0)) {
                data.peakRate = data.rate;
                data.peakRateTime = now;
            }
            
            // Clean up inactive topics (no activity for 2 minutes)
            if (data.timestamps.length === 0 && now - data.lastActivity > 120000) {
                this.topicRates.delete(topicId);
            }
        }
    }

    getTopicMessageRate(connectionId, topic) {
        const topicId = `${connectionId}:${topic}`;
        const rateData = this.topicRates.get(topicId);
        return rateData ? rateData.rate : 0;
    }

    getTopicPeakRate(connectionId, topic) {
        const topicId = `${connectionId}:${topic}`;
        const rateData = this.topicRates.get(topicId);
        return rateData ? (rateData.peakRate || 0) : 0;
    }

    setupEventHandlers() {
        if (this.treeView) {
            this.treeView.addEventListener('click', (e) => {
                if (e.target === this.treeView) {
                    this.clearSelection();
                }
            });
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
            
            // Update the specific DOM element if it exists
            this.updateTopicNodeCount(topic, newCount);
        }
    }

    updateTopicNodeCount(topic, newCount) {
        if (!this.currentActiveConnection) return;
        
        const headerElement = this.domElementCache.get(topic);
        if (headerElement && headerElement.isConnected) {
            const valueElement = headerElement.querySelector('.tree-node-value');
            if (valueElement) {
                // Update just the count part, preserving the rate display
                const currentRate = this.getTopicMessageRate(this.currentActiveConnection.id, topic);
                let rateDisplay = '';
                if (currentRate > 0) {
                    if (currentRate >= 1) {
                        rateDisplay = ` (${currentRate.toFixed(1)}/s)`;
                    } else {
                        rateDisplay = ` (${currentRate.toFixed(2)}/s)`;
                    }
                }
                
                const countInfo = `${newCount} msg${newCount !== 1 ? 's' : ''}${rateDisplay}`;
                
                // Update count while preserving other info
                const currentHTML = valueElement.innerHTML;
                const updatedHTML = currentHTML.replace(
                    /\d+\s*msg[s]?\s*(\([^)]*\))?/,
                    countInfo
                );
                valueElement.innerHTML = updatedHTML;
            }
        }
        
        // NEW: Update all parent nodes that contain this topic
        this.updateParentNodeCounts(topic);
    }

    updateParentNodeCounts(childTopic) {
        if (!this.currentActiveConnection) return;
        
        const parts = childTopic.split('/');
        
        // Walk up the parent hierarchy and update each parent's aggregate counts
        for (let i = 1; i < parts.length; i++) {
            const parentPath = parts.slice(0, i).join('/');
            const parentHeaderElement = this.findParentNodeElement(parentPath);
            
            if (parentHeaderElement) {
                this.updateSingleParentNodeCounts(parentHeaderElement, parentPath);
            }
        }
    }

    updateSingleParentNodeCounts(parentHeaderElement, parentPath) {
        if (!parentHeaderElement) return;
        
        const nodeData = this.findNodeData(this.treeStructure[this.currentActiveConnection.id], parentPath);
        if (!nodeData) return;
        
        const valueElement = parentHeaderElement.querySelector('.tree-node-value');
        if (!valueElement) return;
        
        const hasChildren = Object.keys(nodeData.children).length > 0;
        if (!hasChildren) return;
        
        // Recalculate aggregate counts
        const parts = [];
        if (nodeData.topicCount > 0) {
            parts.push(`${nodeData.topicCount} topic${nodeData.topicCount !== 1 ? 's' : ''}`);
        }
        
        // Calculate current aggregate message count
        let aggregateCount = 0;
        for (const child of Object.values(nodeData.children)) {
            const childPath = child.fullTopic || this.buildChildPath(parentPath, child);
            if (childPath) {
                aggregateCount += this.getTopicMessageCount(this.currentActiveConnection.id, childPath) || 0;
            }
            aggregateCount += this.calculateChildMessageCount(child);
        }
        
        // Add this node's own messages if it's also a topic
        if (nodeData.fullTopic) {
            aggregateCount += this.getTopicMessageCount(this.currentActiveConnection.id, nodeData.fullTopic) || 0;
        }
        
        if (aggregateCount > 0) {
            parts.push(`${aggregateCount} message${aggregateCount !== 1 ? 's' : ''}`);
        }
        
        // Update just the counts part
        const newCountsHTML = parts.join(', ');
        const currentHTML = valueElement.innerHTML;
        
        // Replace counts but preserve message info
        if (currentHTML.includes('|')) {
            const htmlParts = currentHTML.split('|');
            valueElement.innerHTML = newCountsHTML + '|' + htmlParts.slice(1).join('|');
        } else {
            valueElement.innerHTML = newCountsHTML;
        }
    }

    calculateChildMessageCount(childNode) {
        let total = 0;
        
        // Add this child's exact count if it's a topic
        if (childNode.fullTopic) {
            total += this.getTopicMessageCount(this.currentActiveConnection.id, childNode.fullTopic) || 0;
        }
        
        // Recursively add descendant counts
        for (const grandchild of Object.values(childNode.children)) {
            total += this.calculateChildMessageCount(grandchild);
        }
        
        return total;
    }

    // NEW: Build child path from parent path and child node
    buildChildPath(parentPath, childNode) {
        if (childNode.fullTopic) {
            return childNode.fullTopic;
        }
        
        // Find the child key by searching the parent's children
        for (const [key, value] of Object.entries(this.treeStructure[this.currentActiveConnection.id])) {
            if (this.findChildInNode(value, childNode)) {
                return parentPath ? `${parentPath}/${key}` : key;
            }
        }
        
        return null;
    }

    // NEW: Helper to find a child node within a parent node
    findChildInNode(parentNode, targetChild) {
        for (const child of Object.values(parentNode.children)) {
            if (child === targetChild) {
                return true;
            }
            if (this.findChildInNode(child, targetChild)) {
                return true;
            }
        }
        return false;
    }

    findParentNodeElement(parentPath) {
        // First try the cache
        const cachedElement = this.domElementCache.get(parentPath);
        if (cachedElement && cachedElement.isConnected) {
            return cachedElement;
        }
        
        // Fall back to searching the DOM
        const parts = parentPath.split('/');
        let currentContainer = this.treeView;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const nodeElement = this.findExistingDOMNode(currentContainer, part);
            
            if (!nodeElement) return null;
            
            if (i === parts.length - 1) {
                // This is the target parent node
                const headerElement = nodeElement.querySelector('.tree-node-header');
                // Cache it for future use
                if (headerElement) {
                    this.domElementCache.set(parentPath, headerElement);
                }
                return headerElement;
            }
            
            // Move to children container for next iteration
            const childContainer = nodeElement.querySelector('.tree-children');
            if (!childContainer) return null;
            currentContainer = childContainer;
        }
        
        return null;
    }

    // Increment message count (for real-time updates)
    incrementTopicMessageCount(connectionId, topic) {
        const key = `${connectionId}:${topic}`;
        const currentCount = this.messageCounts[key] || 0;
        this.updateTopicMessageCount(connectionId, topic, currentCount + 1);
        
        // Update tree structure to reflect new counts
        this.updateTreeStructure(connectionId, topic);
    }

    // This is the method that ConnectionManager expects to exist
    async updateTopic(connectionId, topic, message) {
        // Always process the update immediately for data integrity
        await this.performTopicUpdate(connectionId, topic, message);
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
            // Store message in IndexedDB - ALWAYS, regardless of window state
            await this.dbManager.addMessage(connectionId, topic, message);
            
            // Track message rate immediately
            const topicId = `${connectionId}:${topic}`;
            if (!this.topicRates.has(topicId)) {
                this.topicRates.set(topicId, {
                    timestamps: [],
                    rate: 0,
                    peakRate: 0,
                    peakRateTime: null,
                    lastActivity: Date.now()
                });
            }
            
            const rateData = this.topicRates.get(topicId);
            rateData.timestamps.push(Date.now());
            rateData.lastActivity = Date.now();
            
            // Update message counts
            const topicKey = `${connectionId}:${topic}`;
            const isNewTopic = !this.knownTopics.has(topicKey);
            
            // Always update tree structure first
            await this.updateTreeStructure(connectionId, topic, message);
            
            if (isNewTopic) {
                console.log('TopicTree: New topic discovered:', topic);
                this.knownTopics.add(topicKey);
                this.newTopicsPending.add(topic);
                this.updateTopicMessageCount(connectionId, topic, 1);
                
                // Only try to add to DOM if we have an active connection and it matches
                if (this.currentActiveConnection && this.currentActiveConnection.id === connectionId) {
                    await this.addNewTopicToDOM(connectionId, topic);
                }
            } else {
                this.incrementTopicMessageCount(connectionId, topic);
                // Update last message for existing topic
                this.updateTopicLastMessage(topic, message);
            }
        } catch (error) {
            console.error('TopicTree: Error updating topic:', error);
        }
    }

    async addNewTopicToDOM(connectionId, topic) {
        if (!this.currentActiveConnection || this.currentActiveConnection.id !== connectionId) {
            return;
        }
        
        // If tree is empty, do a full render
        if (this.treeView.children.length === 0) {
            this.scheduleRender();
            return;
        }
        
        const parts = topic.split('/');
        let currentPath = '';
        let parentContainer = this.treeView;
        
        // Find the deepest existing parent and create missing nodes
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            
            let existingNode = this.findExistingDOMNode(parentContainer, part);
            
            if (!existingNode) {
                // Create the missing node and all its children
                const remainingPath = parts.slice(i).join('/');
                const fullTopicPath = topic; // Use the full topic path
                await this.createAndInsertTopicBranch(parentContainer, parts.slice(i), fullTopicPath, i);
                break;
            } else {
                // Update existing node counts
                this.updateExistingNodeCounts(existingNode, currentPath);
                
                // Get or create children container
                let childContainer = existingNode.querySelector('.tree-children');
                if (!childContainer && i < parts.length - 1) {
                    childContainer = this.createChildrenContainer(existingNode);
                }
                
                if (childContainer) {
                    parentContainer = childContainer;
                }
            }
        }
        
        this.newTopicsPending.delete(topic);
    }

    // NEW: Find existing DOM node by part name
    findExistingDOMNode(container, partName) {
        const nodes = container.querySelectorAll(':scope > .tree-node');
        for (const node of nodes) {
            const nameElement = node.querySelector('.tree-node-name');
            if (nameElement && nameElement.textContent === partName) {
                return node;
            }
        }
        return null;
    }

    // NEW: Create children container if it doesn't exist
    createChildrenContainer(nodeElement) {
        let childContainer = nodeElement.querySelector('.tree-children');
        if (!childContainer) {
            childContainer = document.createElement('ul');
            childContainer.className = 'tree-children';
            nodeElement.appendChild(childContainer);
        }
        return childContainer;
    }

    // NEW: Create and insert a new topic branch
    async createAndInsertTopicBranch(container, remainingParts, fullTopic, startIndex = 0) {
        if (remainingParts.length === 0) return;
        
        for (let i = 0; i < remainingParts.length; i++) {
            const part = remainingParts[i];
            const currentTopicPath = fullTopic.split('/').slice(0, startIndex + i + 1).join('/');
            
            // Find the node data for this part
            const nodeData = this.findNodeData(this.treeStructure[this.currentActiveConnection.id], currentTopicPath);
            
            if (!nodeData) {
                console.warn('TopicTree: Could not find node data for path:', currentTopicPath);
                continue;
            }
            
            const nodeElement = await this.createSingleTreeNode(part, nodeData, currentTopicPath);
            container.appendChild(nodeElement);
            
            // Cache the DOM element if this is a full topic
            if (nodeData.fullTopic) {
                const headerElement = nodeElement.querySelector('.tree-node-header');
                this.domElementCache.set(nodeData.fullTopic, headerElement);
            }
            
            // If there are more parts, create children container and continue
            if (i < remainingParts.length - 1) {
                const childContainer = this.createChildrenContainer(nodeElement);
                container = childContainer;
            }
        }
    }

    async createSingleTreeNode(key, value, fullPath) {
        const nodeElement = document.createElement('li');
        nodeElement.className = 'tree-node';
        
        const headerElement = document.createElement('div');
        headerElement.className = 'tree-node-header';
        
        const hasChildren = Object.keys(value.children).length > 0;
        const hasMessages = value.fullTopic && this.getTopicMessageCount(this.currentActiveConnection.id, value.fullTopic) > 0;
        
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
        } else {
            iconElement.innerHTML = '&nbsp;';
        }
        headerElement.appendChild(iconElement);
        
        // Add node name
        const nameElement = document.createElement('span');
        nameElement.className = 'tree-node-name';
        nameElement.textContent = key;
        headerElement.appendChild(nameElement);
        
        // Add topic/message counts and current value with rate
        const infoElement = document.createElement('span');
        infoElement.className = 'tree-node-value';
        
        let infoHTML = '';
        
        // Show children summary for parent nodes
        if (hasChildren) {
            const parts = [];
            if (value.topicCount > 0) parts.push(`${value.topicCount} topic${value.topicCount !== 1 ? 's' : ''}`);
            
            // Show aggregate message count for children
            let aggregateCount = 0;
            for (const child of Object.values(value.children)) {
                aggregateCount += child.exactMessageCount || 0;
            }
            
            // Add this node's own messages if it's also a topic
            if (value.fullTopic) {
                aggregateCount += value.exactMessageCount || 0;
            }
            
            if (aggregateCount > 0) {
                parts.push(`${aggregateCount} message${aggregateCount !== 1 ? 's' : ''}`);
            }
            
            infoHTML = parts.join(', ');
        }
        
        // Add current topic's exact message info if it has messages
        if (hasMessages) {
            const exactCount = this.getTopicMessageCount(this.currentActiveConnection.id, value.fullTopic);
            const currentRate = this.getTopicMessageRate(this.currentActiveConnection.id, value.fullTopic);
            
            let rateDisplay = '';
            if (currentRate > 0) {
                if (currentRate >= 1) {
                    rateDisplay = ` (${currentRate.toFixed(1)}/s)`;
                } else {
                    rateDisplay = ` (${currentRate.toFixed(2)}/s)`;
                }
            }
            
            const currentInfo = `${exactCount} msg${exactCount !== 1 ? 's' : ''}${rateDisplay}`;
            const messagePayload = value.lastMessage ? 
                `<span class="message-payload">${escapeHtml(value.lastMessage)}</span>` : '';
            
            if (infoHTML && hasChildren) {
                // For nodes that have both children and are topics themselves
                infoHTML += ` | This topic: ${currentInfo}${messagePayload ? ': ' + messagePayload : ''}`;
            } else {
                // For leaf nodes or nodes without children
                infoHTML = `${currentInfo}${messagePayload ? ': ' + messagePayload : ''}`;
            }
        }
        
        infoElement.innerHTML = infoHTML;
        headerElement.appendChild(infoElement);
        
        nodeElement.appendChild(headerElement);
        
        // Click handler for the entire header bar
        headerElement.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (hasMessages && !hasChildren) {
                this.selectTopic(value.fullTopic);
            } else if (hasChildren) {
                this.toggleNodeExpansion(value, key);
            } else if (hasMessages) {
                this.selectTopic(value.fullTopic);
            }
        });
        
        return nodeElement;
    }


    updateExistingNodeCounts(nodeElement, topicPath) {
        const headerElement = nodeElement.querySelector('.tree-node-header');
        if (!headerElement) return;
        
        const nodeData = this.findNodeData(this.treeStructure[this.currentActiveConnection.id], topicPath);
        if (!nodeData) return;
        
        const valueElement = headerElement.querySelector('.tree-node-value');
        if (!valueElement) return;
        
        // Update counts for parent nodes
        const hasChildren = Object.keys(nodeData.children).length > 0;
        if (hasChildren) {
            const parts = [];
            if (nodeData.topicCount > 0) parts.push(`${nodeData.topicCount} topic${nodeData.topicCount !== 1 ? 's' : ''}`);
            
            // Calculate aggregate message count
            let aggregateCount = 0;
            for (const child of Object.values(nodeData.children)) {
                aggregateCount += child.exactMessageCount || 0;
            }
            
            // Add this node's own messages if it's also a topic
            if (nodeData.fullTopic) {
                aggregateCount += nodeData.exactMessageCount || 0;
            }
            
            if (aggregateCount > 0) {
                parts.push(`${aggregateCount} message${aggregateCount !== 1 ? 's' : ''}`);
            }
            
            // Update just the counts part
            const newCountsHTML = parts.join(', ');
            const currentHTML = valueElement.innerHTML;
            
            // Replace counts but preserve message info
            if (currentHTML.includes('|')) {
                const htmlParts = currentHTML.split('|');
                valueElement.innerHTML = newCountsHTML + '|' + htmlParts.slice(1).join('|');
            } else {
                valueElement.innerHTML = newCountsHTML;
            }
        }
    }

    updateTopicLastMessage(topic, message) {
        const headerElement = this.domElementCache.get(topic);
        if (headerElement && headerElement.isConnected) {
            const valueElement = headerElement.querySelector('.tree-node-value');
            if (valueElement) {
                // Update the message payload
                const payloadRegex = /<span class="message-payload">.*?<\/span>/;
                const newPayload = `<span class="message-payload">${escapeHtml(message)}</span>`;
                
                if (payloadRegex.test(valueElement.innerHTML)) {
                    valueElement.innerHTML = valueElement.innerHTML.replace(payloadRegex, newPayload);
                } else {
                    // Add payload if it doesn't exist
                    valueElement.innerHTML += `: ${newPayload}`;
                }
            }
        }
    }

    async loadExistingMessageCounts(connectionId) {
        try {
            // Get all topics for this connection from the database
            const allMessages = await this.dbManager.getAllMessagesForConnection(connectionId);
            
            // Group messages by topic and count them
            const topicCounts = {};
            allMessages.forEach(msg => {
                const key = `${connectionId}:${msg.topic}`;
                topicCounts[key] = (topicCounts[key] || 0) + 1;
            });
            
            // Update our message counts
            Object.assign(this.messageCounts, topicCounts);
            
            // Mark all topics as known
            Object.keys(topicCounts).forEach(key => {
                this.knownTopics.add(key);
            });
            
            console.log(`TopicTree: Loaded ${Object.keys(topicCounts).length} topics with message counts for connection ${connectionId}`);
            
        } catch (error) {
            console.error('TopicTree: Error loading existing message counts:', error);
        }
    }

    // Force update method for when window becomes visible
    forceUpdate() {
        console.log('TopicTree: Force update requested');
        if (this.currentActiveConnection) {
            // Only re-render if there are pending new topics
            if (this.newTopicsPending.size > 0) {
                this.scheduleRender();
            }
        }
    }

    // Modified: Only do full render when explicitly needed (new topics or structural changes)
    scheduleRender() {
        if (this.renderPending) {
            console.log('TopicTree: Render already pending, skipping');
            return;
        }
        
        console.log('TopicTree: Scheduling render');
        this.renderPending = true;
        
        setTimeout(async () => {
            console.log('TopicTree: Executing scheduled render');
            await this.render(this.currentActiveConnection);
            this.renderPending = false;
        }, 0);
    }

    async updateTreeStructure(connectionId, topic, message = null) {
        if (!this.treeStructure[connectionId]) {
            this.treeStructure[connectionId] = {};
        }

        const parts = topic.split('/');
        let current = this.treeStructure[connectionId];
        
        // Build the full path for each level
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const currentTopicPath = parts.slice(0, i + 1).join('/');
            
            if (!current[part]) {
                current[part] = {
                    children: {},
                    isExpanded: false,
                    fullTopic: null,
                    messageCount: 0,
                    topicCount: 0,
                    lastMessage: null,
                    lastUpdate: Date.now(),
                    exactMessageCount: 0
                };
            }
            
            // Check if this exact path has messages
            const exactCount = this.getTopicMessageCount(connectionId, currentTopicPath);
            current[part].exactMessageCount = exactCount;
            
            if (i === parts.length - 1) {
                // This is the final topic node
                current[part].fullTopic = topic;
                current[part].lastUpdate = Date.now();
                if (message) {
                    current[part].lastMessage = message;
                }
            }
            
            current = current[part].children;
        }
        
        // Update counts up the tree with exact topic tracking
        this.updateCountsWithExactTracking(this.treeStructure[connectionId], connectionId);
    }


    updateCountsWithExactTracking(node, connectionId, currentPath = '') {
        for (const [key, value] of Object.entries(node)) {
            const fullPath = currentPath ? `${currentPath}/${key}` : key;
            
            let childTopicCount = 0;
            let childMessageCount = 0;
            
            // Get exact message count for this specific topic path
            const exactCount = this.getTopicMessageCount(connectionId, fullPath);
            value.exactMessageCount = exactCount;
            
            if (Object.keys(value.children).length > 0) {
                // Recursively update children
                this.updateCountsWithExactTracking(value.children, connectionId, fullPath);
                
                // Sum up children counts
                for (const child of Object.values(value.children)) {
                    if (child.fullTopic) {
                        childTopicCount++;
                    }
                    childTopicCount += child.topicCount || 0;
                    childMessageCount += child.exactMessageCount || 0;
                }
            }
            
            value.topicCount = childTopicCount;
            
            // For parent nodes, show aggregated count of children + own messages
            if (value.fullTopic) {
                // This is an actual topic, show its exact count
                value.messageCount = exactCount;
            } else {
                // This is a parent node, show aggregate of children
                value.messageCount = childMessageCount;
            }
        }
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
                        childMessageCount += this.getTopicMessageCount(this.currentActiveConnection?.id, child.fullTopic) || 0;
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
        console.log('TopicTree: render() called with connection:', activeConnection?.name);
        
        const previousConnection = this.currentActiveConnection;
        this.currentActiveConnection = activeConnection;
        
        if (!activeConnection || (this.selectedTopic && previousConnection && previousConnection.id !== activeConnection.id)) {
            this.selectedTopic = null;
        }
        
        // Load existing message counts if switching to a new connection
        if (activeConnection && (!previousConnection || previousConnection.id !== activeConnection.id)) {
            await this.loadExistingMessageCounts(activeConnection.id);
            
            // Rebuild tree structure with loaded counts
            const topics = Array.from(this.knownTopics)
                .filter(key => key.startsWith(`${activeConnection.id}:`))
                .map(key => key.substring(`${activeConnection.id}:`.length));
            
            for (const topic of topics) {
                await this.updateTreeStructure(activeConnection.id, topic);
            }
        }
        
        this.updateTreeHeader(activeConnection);
        await this.renderTreeNodes(activeConnection);
        
        // Clear the DOM cache and rebuild it
        this.domElementCache.clear();
        this.cacheDOMElements();
        
        console.log('TopicTree: render() completed, cached elements:', this.domElementCache.size);
    }

    forceFullRender() {
    console.log('TopicTree: Force full render requested');
    if (this.currentActiveConnection) {
        this.scheduleRender();
    }
}

    updateTreeHeader(activeConnection) {
        const treeHeader = document.querySelector('.tree-header');
        if (!treeHeader) {
            console.warn('TopicTree: .tree-header element not found');
            return;
        }

        if (activeConnection) {
            treeHeader.className = 'tree-header has-active-connection';
            const connectionTopics = Array.from(this.knownTopics)
                .filter(key => key.startsWith(`${activeConnection.id}:`));
            treeHeader.innerHTML = `
                Topic Tree (${connectionTopics.length} topics)
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
        
        console.log('TopicTree: Rendering tree nodes for connection:', activeConnection.id);
        console.log('TopicTree: Tree data:', treeData);
        
        // Only render visible (expanded) nodes
        await this.renderVisibleNodes(treeData, this.treeView, 0);
        
        console.log('TopicTree: Finished rendering, DOM elements:', this.treeView.children.length);
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

    // Enhanced render with rate display
    async renderVisibleNodes(node, container, level) {
        if (!node) return;
        
        for (const [key, value] of Object.entries(node)) {
            const nodeElement = await this.createSingleTreeNode(key, value, value.fullTopic || '');
            container.appendChild(nodeElement);
            
            // Cache the DOM element
            if (value.fullTopic) {
                const headerElement = nodeElement.querySelector('.tree-node-header');
                this.domElementCache.set(value.fullTopic, headerElement);
            }
            
            // Only render children if expanded (lazy rendering)
            if (value.isExpanded && Object.keys(value.children).length > 0) {
                const childContainer = document.createElement('ul');
                childContainer.className = 'tree-children';
                await this.renderVisibleNodes(value.children, childContainer, level + 1);
                nodeElement.appendChild(childContainer);
            }
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
        // Update selection styling without full re-render
        this.updateSelectionStyling();
        this.emit('topic-selected', topic);
    }

    // NEW: Update selection styling without full re-render
    updateSelectionStyling() {
        // Remove all existing selections
        const allHeaders = this.treeView.querySelectorAll('.tree-node-header.selected');
        allHeaders.forEach(header => header.classList.remove('selected'));
        
        // Add selection to current topic
        if (this.selectedTopic) {
            const headerElement = this.domElementCache.get(this.selectedTopic);
            if (headerElement) {
                headerElement.classList.add('selected');
            }
        }
    }

    clearSelection() {
        this.selectedTopic = null;
        this.updateSelectionStyling();
        this.emit('selection-cleared');
    }

    cacheDOMElements() {
    const headers = this.treeView.querySelectorAll('.tree-node-header');
    headers.forEach(header => {
        const topic = this.getTopicPathFromElement(header);
        if (topic) {
            this.domElementCache.set(topic, header);
        }
    });
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

    clear() {
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.treeStructure = {};
        this.messageCounts = {};
        this.knownTopics.clear();
        this.newTopicsPending.clear();
        this.domElementCache.clear();
        
        if (this.treeView) {
            this.treeView.innerHTML = '';
        }
        
        // Clear throttle timers
        this.updateThrottle.forEach(timer => clearTimeout(timer));
        this.updateThrottle.clear();
        
        // Clear intervals
        if (this.rateUpdateInterval) {
            clearInterval(this.rateUpdateInterval);
            this.rateUpdateInterval = null;
        }
        
        const treeHeader = document.querySelector('.tree-header');
        if (treeHeader) {
            treeHeader.className = 'tree-header';
            treeHeader.innerHTML = 'Topic Tree';
        }
        
        this.emit('selection-cleared');
        
        // Restart rate tracking
        this.startRateTracking();
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
        
        // Clear rate data for this connection
        for (const [topicId] of this.topicRates.entries()) {
            if (topicId.startsWith(`${connectionId}:`)) {
                this.topicRates.delete(topicId);
            }
        }
        
        // Clear DOM cache for this connection
        const topicsToRemove = [];
        this.domElementCache.forEach((element, topic) => {
            if (this.knownTopics.has(`${connectionId}:${topic}`)) {
                topicsToRemove.push(topic);
            }
        });
        topicsToRemove.forEach(topic => this.domElementCache.delete(topic));
        
        if (this.currentActiveConnection && this.currentActiveConnection.id === connectionId) {
            this.scheduleRender();
        }
    }

    // Method called by ConnectionManager when messages arrive
    async onMessageReceived(connectionId, topic, message) {
        await this.performTopicUpdate(connectionId, topic, message);
    }
}

module.exports = TopicTree;