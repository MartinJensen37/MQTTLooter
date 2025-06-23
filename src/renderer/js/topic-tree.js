const EventEmitter = require('events');
const { escapeHtml } = require('./utils');

class TopicTree extends EventEmitter {
    constructor() {
        super();
        this.treeView = document.getElementById('tree-view');
        this.selectedTopic = null;
        this.currentActiveConnection = null; // Track current connection
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Clear selection when clicking on empty tree area
        this.treeView.addEventListener('click', (e) => {
            if (e.target === this.treeView) {
                this.clearSelection();
            }
        });
    }

    updateTopic(connectionId, topic, message) {
        // Only update if this is for the current active connection
        if (this.currentActiveConnection && this.currentActiveConnection.id === connectionId) {
            this.render(this.currentActiveConnection);
            
            // If the selected topic matches the updated topic, update the message panel
            if (this.selectedTopic === topic) {
                this.emit('topic-selected', topic);
            }
        }
    }

    render(activeConnection = null) {
        // Store the current active connection
        this.currentActiveConnection = activeConnection;
        
        // If switching connections, clear the selected topic
        if (!activeConnection || (this.currentActiveConnection && this.currentActiveConnection.id !== activeConnection.id)) {
            this.selectedTopic = null;
        }
        
        this.updateTreeHeader(activeConnection);
        this.renderTreeNodes(activeConnection);
    }

    updateTreeHeader(activeConnection) {
        const treeHeader = document.querySelector('.tree-header');
        if (!treeHeader) return;

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

    renderTreeNodes(activeConnection) {
        // Always clear the tree view first
        this.treeView.innerHTML = '';
        
        if (!activeConnection) {
            // Show empty state
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'no-topic-selected';
            emptyMessage.style.cssText = 'text-align: center; padding: 20px; color: #6c757d; font-style: italic;';
            emptyMessage.textContent = 'No active connection';
            this.treeView.appendChild(emptyMessage);
            return;
        }
        
        // ONLY SHOW TREE IF CONNECTION IS ACTUALLY CONNECTED
        if (!activeConnection.connected) {
            const disconnectedMessage = document.createElement('div');
            disconnectedMessage.className = 'no-topic-selected';
            disconnectedMessage.style.cssText = 'text-align: center; padding: 20px; color: #6c757d; font-style: italic;';
            
            // Show simple "No active connection" message for all non-connected states
            disconnectedMessage.textContent = 'No active connection';
            
            this.treeView.appendChild(disconnectedMessage);
            return;
        }
        
        if (!activeConnection.topicTree || Object.keys(activeConnection.topicTree).length === 0) {
            // Show waiting for messages state
            const waitingMessage = document.createElement('div');
            waitingMessage.className = 'no-topic-selected';
            waitingMessage.style.cssText = 'text-align: center; padding: 20px; color: #6c757d; font-style: italic;';
            waitingMessage.innerHTML = `
                <div style="color: #2ecc71; margin-bottom: 10px;">Connected</div>
                <div style="font-size: 14px;">Waiting for MQTT messages...</div>
            `;
            this.treeView.appendChild(waitingMessage);
            return;
        }
        
        // Render the actual tree
        this.renderNode(activeConnection.topicTree, this.treeView, 0);
    }

    renderNode(node, container, level) {
        if (!node) return;
        
        for (const [key, value] of Object.entries(node)) {
            const nodeElement = document.createElement('li');
            nodeElement.className = 'tree-node';
            
            const headerElement = document.createElement('div');
            headerElement.className = 'tree-node-header';
            
            const hasChildren = value.children && Object.keys(value.children).length > 0;
            const hasMessages = value.messages && value.messages.length > 0;
            
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
                iconElement.innerHTML = '&nbsp;'; // Empty space for alignment
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
                const counts = this.countTopicsAndMessages(value.children);
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
            
            // Click handlers - FIXED: Pass the active connection to render
            iconElement.addEventListener('click', (e) => {
                e.stopPropagation();
                if (hasChildren) {
                    this.toggleNodeExpansion(value);
                }
            });
            
            nameElement.addEventListener('click', (e) => {
                e.stopPropagation();
                if (hasMessages) {
                    this.selectTopic(value.fullTopic);
                } else if (hasChildren) {
                    this.toggleNodeExpansion(value);
                }
            });
            
            // Render children if expanded
            if (value.isExpanded && hasChildren) {
                const childContainer = document.createElement('ul');
                childContainer.className = 'tree-children';
                this.renderNode(value.children, childContainer, level + 1);
                nodeElement.appendChild(childContainer);
            }
            
            container.appendChild(nodeElement);
        }
    }

    toggleNodeExpansion(node) {
        node.isExpanded = !node.isExpanded;
        this.emit('node-toggled', node);
        // FIXED: Pass the current active connection to render
        this.render(this.currentActiveConnection);
    }

    selectTopic(topic) {
        this.selectedTopic = topic;
        // FIXED: Pass the current active connection to render
        this.render(this.currentActiveConnection);
        this.emit('topic-selected', topic);
    }

    clearSelection() {
        this.selectedTopic = null;
        // FIXED: Pass the current active connection to render
        this.render(this.currentActiveConnection);
        this.emit('selection-cleared');
    }

    // Add method to clear the tree completely
    clear() {
        this.selectedTopic = null;
        this.currentActiveConnection = null;
        this.treeView.innerHTML = '';
        
        // Reset header
        const treeHeader = document.querySelector('.tree-header');
        if (treeHeader) {
            treeHeader.className = 'tree-header';
            treeHeader.innerHTML = 'Topic Tree';
        }
    }

    countTopicsAndMessages(node) {
        let topicCount = 0;
        let messageCount = 0;
        
        if (!node) return { topics: 0, messages: 0 };
        
        for (const [key, value] of Object.entries(node)) {
            // If this node has messages, it's a topic
            if (value.messages && value.messages.length > 0) {
                topicCount++;
                messageCount += value.messages.length;
            }
            
            // Recursively count children
            if (value.children && Object.keys(value.children).length > 0) {
                const childCounts = this.countTopicsAndMessages(value.children);
                topicCount += childCounts.topics;
                messageCount += childCounts.messages;
            }
        }
        
        return { topics: topicCount, messages: messageCount };
    }

    findTopicInTree(node, targetTopic) {
        if (!node) return null;
        
        for (const [key, value] of Object.entries(node)) {
            if (value.fullTopic === targetTopic) {
                return value;
            }
            
            if (value.children && Object.keys(value.children).length > 0) {
                const found = this.findTopicInTree(value.children, targetTopic);
                if (found) return found;
            }
        }
        return null;
    }

    getSelectedTopic() {
        return this.selectedTopic;
    }

    expandAllNodes(node) {
        if (!node) return;
        
        for (const [key, value] of Object.entries(node)) {
            value.isExpanded = true;
            if (value.children && Object.keys(value.children).length > 0) {
                this.expandAllNodes(value.children);
            }
        }
        this.render(this.currentActiveConnection);
        this.emit('nodes-expanded');
    }

    collapseAllNodes(node) {
        if (!node) return;
        
        for (const [key, value] of Object.entries(node)) {
            value.isExpanded = false;
            if (value.children && Object.keys(value.children).length > 0) {
                this.collapseAllNodes(value.children);
            }
        }
        this.render(this.currentActiveConnection);
        this.emit('nodes-collapsed');
    }

    filterTopics(searchTerm, activeConnection) {
        if (!searchTerm || !activeConnection) {
            this.render(activeConnection);
            return;
        }

        const filteredTree = this.filterNode(activeConnection.topicTree, searchTerm.toLowerCase());
        
        // Temporarily replace the tree for rendering
        const originalTree = activeConnection.topicTree;
        activeConnection.topicTree = filteredTree;
        this.render(activeConnection);
        activeConnection.topicTree = originalTree;
    }

    filterNode(node, searchTerm) {
        const filtered = {};
        
        if (!node) return filtered;
        
        for (const [key, value] of Object.entries(node)) {
            const matches = key.toLowerCase().includes(searchTerm) ||
                           (value.fullTopic && value.fullTopic.toLowerCase().includes(searchTerm)) ||
                           (value.messages && value.messages.some(msg => 
                               msg.value.toLowerCase().includes(searchTerm)));
            
            if (matches) {
                filtered[key] = { ...value, isExpanded: true };
            } else if (value.children && Object.keys(value.children).length > 0) {
                const filteredChildren = this.filterNode(value.children, searchTerm);
                if (Object.keys(filteredChildren).length > 0) {
                    filtered[key] = {
                        ...value,
                        children: filteredChildren,
                        isExpanded: true
                    };
                }
            }
        }
        
        return filtered;
    }

    getTopicStats(activeConnection) {
        if (!activeConnection || !activeConnection.topicTree) {
            return { totalTopics: 0, totalMessages: 0 };
        }

        const counts = this.countTopicsAndMessages(activeConnection.topicTree);
        return {
            totalTopics: counts.topics,
            totalMessages: counts.messages
        };
    }

    exportTree(activeConnection, format = 'json') {
        if (!activeConnection || !activeConnection.topicTree) {
            return null;
        }

        switch (format) {
            case 'json':
                return JSON.stringify(activeConnection.topicTree, null, 2);
            case 'text':
                return this.treeToText(activeConnection.topicTree, '');
            default:
                return null;
        }
    }

    treeToText(node, prefix = '') {
        let result = '';
        
        if (!node) return result;
        
        for (const [key, value] of Object.entries(node)) {
            result += `${prefix}${key}`;
            
            if (value.messages && value.messages.length > 0) {
                result += ` (${value.messages.length} messages)`;
                result += ` - Latest: ${value.messages[0].value}`;
            }
            
            result += '\n';
            
            if (value.children && Object.keys(value.children).length > 0) {
                result += this.treeToText(value.children, prefix + '  ');
            }
        }
        
        return result;
    }
}

module.exports = TopicTree;