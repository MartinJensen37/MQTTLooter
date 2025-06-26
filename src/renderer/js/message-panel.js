const EventEmitter = require('events');
const { escapeHtml, formatTimestamp } = require('./utils');

class MessagePanel extends EventEmitter {
    constructor(topicTree) {
        super();
        
        if (!topicTree) {
            throw new Error('MessagePanel requires a valid TopicTree instance');
        }
        
        this.topicTree = topicTree;
        this.dbManager = null;
        this.messagePanel = document.querySelector('.message-panel');
        this.messageHeader = document.querySelector('.message-header');
        this.messageContent = document.querySelector('.message-content');
        this.messageDetails = document.getElementById('message-details');
        this.currentTopic = null;
        this.currentConnection = null;
        this.currentMessages = [];
        this.messagesPerPage = 50;
        this.currentPage = 0;
        this.isDbReady = false;
        this.maxDisplayMessages = 300;
        this.updateThrottle = null;
        this.messageCount = 0;
        this.lastCountUpdate = 0;
        this.userScrolledAway = false;
        this.autoScrollEnabled = false;
        this.countUpdateThrottle = null;
        this.headerCreated = false;
        this.lastDisplayedCount = 0;
        
        // Enhanced rate tracking that works in background
        this.messageRateHistory = new Map();
        this.rateUpdateInterval = null;
        this.backgroundMessageCount = 0; // Track messages even when window is hidden
        
        // Enhanced throttling system - works in background
        this.pendingCountUpdate = false;
        this.messagesReceivedSinceLastUpdate = 0;
        this.lastUpdateTime = 0;
        this.messageReceiveRate = 0;
        this.rateCalculationWindow = 5000; // 5 seconds
        this.messageTimestamps = [];
        
        this.setupEventHandlers();
        this.startContinuousRateTracking();
    }

    startContinuousRateTracking() {
        // Track rates continuously regardless of window visibility
        this.rateUpdateInterval = setInterval(() => {
            this.updateContinuousRates();
        }, 1000);
    }

    updateContinuousRates() {
        if (this.currentTopic && this.currentConnection && this.dbManager) {
            // Get current rate from database manager
            const rate = this.dbManager.getTopicMessageRate(this.currentConnection.id, this.currentTopic);
            const peakRate = this.dbManager.getTopicPeakRate(this.currentConnection.id, this.currentTopic);
            
            this.messageReceiveRate = rate;
            
            // Store rate history
            if (!this.messageRateHistory.has(this.currentTopic)) {
                this.messageRateHistory.set(this.currentTopic, []);
            }
            
            const history = this.messageRateHistory.get(this.currentTopic);
            history.push({ 
                timestamp: Date.now(), 
                rate,
                peakRate
            });
            
            // Keep only last 5 minutes of history
            const cutoff = Date.now() - 300000;
            this.messageRateHistory.set(this.currentTopic, 
                history.filter(entry => entry.timestamp > cutoff)
            );
            
            // Update display if window is visible
            if (!document.hidden) {
                this.updateRateDisplay();
            }
        }
    }

    async initializeDbManager() {
        if (this.isDbReady && this.dbManager) {
            return;
        }
        
        if (!this.topicTree) {
            throw new Error('TopicTree is not available');
        }
        
        if (this.topicTree.isInitialized && this.topicTree.dbManager) {
            this.dbManager = this.topicTree.dbManager;
            this.isDbReady = true;
            return;
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Database initialization timeout'));
            }, 10000);
            
            const onDatabaseReady = () => {
                clearTimeout(timeout);
                
                if (this.topicTree && this.topicTree.dbManager) {
                    this.dbManager = this.topicTree.dbManager;
                    this.isDbReady = true;
                    resolve();
                } else {
                    reject(new Error('Database manager still not available after ready event'));
                }
            };

            this.topicTree.once('database-ready', onDatabaseReady);
            
            if (this.topicTree.isInitialized && this.topicTree.dbManager) {
                this.topicTree.removeListener('database-ready', onDatabaseReady);
                clearTimeout(timeout);
                onDatabaseReady();
            }
        });
    }

    setupEventHandlers() {
        this.messageDetails.addEventListener('scroll', (e) => {
            const element = e.target;
            this.userScrolledAway = element.scrollTop > 100;
            
            if (element.scrollTop + element.clientHeight >= element.scrollHeight - 5) {
                this.loadMoreMessages();
            }
        });
    }

    // Helper function to break topic path at slashes with max width
    formatTopicPath(topic, maxLength = 60) {
        if (topic.length <= maxLength) {
            return topic;
        }
        
        // Find the best place to break at a slash
        const parts = topic.split('/');
        let currentLine = '';
        let result = '';
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const testLine = currentLine + (currentLine ? '/' : '') + part;
            
            if (testLine.length <= maxLength) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    result += currentLine + '\n';
                    currentLine = part;
                } else {
                    // Part itself is too long, just add it
                    result += part + '\n';
                    currentLine = '';
                }
            }
        }
        
        if (currentLine) {
            result += currentLine;
        }
        
        return result.trim();
    }

    // Helper method to find node data in tree structure (same as in topic-tree.js)
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

    // Get message count from topic tree if available
    getTopicMessageCount() {
        if (this.currentTopic && this.currentConnection && this.topicTree) {
            // Try to get count from topic tree's tree structure
            const treeData = this.topicTree.treeStructure[this.currentConnection.id];
            if (treeData) {
                const nodeData = this.findNodeData(treeData, this.currentTopic);
                if (nodeData && nodeData.messageCount !== undefined) {
                    return nodeData.messageCount;
                }
            }
        }
        // Fall back to background count or local count
        return this.backgroundMessageCount > 0 ? this.backgroundMessageCount : this.messageCount;
    }

    refreshWhenVisible() {
        console.log('MessagePanel: Refreshing when visible');
        
        if (this.currentTopic && this.currentConnection) {
            // Update message count from database
            this.updateMessageCountFromDatabase();
            
            // Update rate display
            this.updateRateDisplay();
            
            // Check for new messages that arrived while window was hidden
            this.loadLatestMessages();
        }
    }

    async updateMessageCountFromDatabase() {
        if (!this.currentTopic || !this.currentConnection || !this.isDbReady) return;
        
        try {
            const metadata = await this.dbManager.getTopicMetadata(`${this.currentConnection.id}:${this.currentTopic}`);
            if (metadata) {
                this.backgroundMessageCount = metadata.messageCount;
                this.messageCount = metadata.messageCount;
                this.updateMessageCountDisplay();
            }
        } catch (error) {
            console.error('Error updating message count from database:', error);
        }
    }

    async loadLatestMessages() {
        if (!this.currentTopic || !this.currentConnection || !this.isDbReady) return;
        
        try {
            // Get count of messages in database
            const metadata = await this.dbManager.getTopicMetadata(`${this.currentConnection.id}:${this.currentTopic}`);
            if (metadata && metadata.messageCount > this.currentMessages.length) {
                console.log(`Found ${metadata.messageCount - this.currentMessages.length} new messages while window was hidden`);
                // Refresh the display to show new messages
                this.showTopicMessages(this.currentTopic, this.currentConnection);
            }
        } catch (error) {
            console.error('Error loading latest messages:', error);
        }
    }

    toggleAutoScroll() {
        this.autoScrollEnabled = !this.autoScrollEnabled;
        this.updateAutoScrollButton();
        
        if (this.autoScrollEnabled) {
            setTimeout(() => this.scrollToTop(), 100);
        }
    }

    scrollToTop() {
        if (!this.messageDetails) return;

        const firstMessage = this.messageDetails.querySelector('.message-item');
        if (firstMessage) {
            firstMessage.scrollIntoView({ 
                behavior: 'instant', 
                block: 'start',
                inline: 'nearest'
            });
        }
    }

    updateAutoScrollButton() {
        const autoScrollBtn = this.messageDetails.querySelector('.auto-scroll-btn');
        if (autoScrollBtn) {
            const slider = autoScrollBtn.querySelector('.toggle-slider');
            const label = autoScrollBtn.querySelector('.toggle-label');
            
            if (slider && label) {
                slider.classList.toggle('active', this.autoScrollEnabled);
                label.textContent = this.autoScrollEnabled ? 'Auto-scroll ON' : 'Auto-scroll OFF';
                autoScrollBtn.title = this.autoScrollEnabled ? 'Auto-scroll enabled (click to disable)' : 'Auto-scroll disabled (click to enable)';
                
                if (this.autoScrollEnabled) {
                    slider.style.background = '#28a745';
                    slider.firstElementChild.style.transform = 'translateX(16px)';
                } else {
                    slider.style.background = '#ccc';
                    slider.firstElementChild.style.transform = 'translateX(0)';
                }
            }
        }
    }

    async copyTopicName() {
        if (!this.currentTopic) return;
        
        try {
            await navigator.clipboard.writeText(this.currentTopic);
            const copyBtn = this.messageDetails.querySelector('.copy-topic-btn');
            if (copyBtn) {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<span style="color: white;">✓ Copied</span>';
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                }, 1500);
            }
        } catch (error) {
            console.error('Failed to copy topic name:', error);
        }
    }

    // Enhanced updateIfSelected - continues to work in background
    async updateIfSelected(topic, message) {
        // Always update background counters
        if (this.currentTopic === topic && this.currentConnection) {
            this.backgroundMessageCount++;
            
            // Only update display if window is visible and database is ready
            if (!document.hidden && this.isDbReady && this.headerCreated) {
                if (this.updateThrottle) {
                    clearTimeout(this.updateThrottle);
                }
                
                this.updateThrottle = setTimeout(() => {
                    this.appendNewMessage(message);
                    this.updateThrottle = null;
                }, 25);
            }
            
            // Always update smart count system
            this.smartCountUpdate();
        }
    }

    appendNewMessage(message) {
        if (!this.currentTopic || !this.messageDetails) return;
        
        const messageLog = this.messageDetails.querySelector('.message-log');
        if (!messageLog) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = 'message-item';
        messageElement.innerHTML = `
            <div class="message-timestamp">${formatTimestamp(new Date())}</div>
            <div class="message-value">${escapeHtml(message)}</div>
        `;
        
        messageLog.insertBefore(messageElement, messageLog.firstChild);
        
        // Smart count update with adaptive throttling
        this.smartCountUpdate();
        
        this.limitDisplayedMessages();
        
        if (this.autoScrollEnabled) {
            messageElement.scrollIntoView({ 
                behavior: 'instant', 
                block: 'start',
                inline: 'nearest'
            });
        }
    }

    // Enhanced smart count update - works in background
    smartCountUpdate() {
        const now = Date.now();
        this.messagesReceivedSinceLastUpdate++;
        
        // Track message timestamps for rate calculation
        this.messageTimestamps.push(now);
        this.messageTimestamps = this.messageTimestamps.filter(ts => now - ts < this.rateCalculationWindow);
        
        // Calculate current rate
        this.messageReceiveRate = this.messageTimestamps.length / (this.rateCalculationWindow / 1000);
        
        // Determine update strategy based on visibility and rate
        const timeSinceLastUpdate = now - this.lastUpdateTime;
        let shouldUpdate = false;
        let updateDelay = document.hidden ? 2000 : 50; // Longer delay when hidden
        
        if (this.messageReceiveRate > 50) {
            shouldUpdate = this.messagesReceivedSinceLastUpdate >= 20 || timeSinceLastUpdate >= 5000;
            updateDelay = document.hidden ? 5000 : 100;
        } else if (this.messageReceiveRate > 20) {
            shouldUpdate = this.messagesReceivedSinceLastUpdate >= 10 || timeSinceLastUpdate >= 2000;
            updateDelay = document.hidden ? 3000 : 75;
        } else if (this.messageReceiveRate > 5) {
            shouldUpdate = this.messagesReceivedSinceLastUpdate >= 5 || timeSinceLastUpdate >= 1000;
            updateDelay = document.hidden ? 2000 : 50;
        } else {
            shouldUpdate = this.messagesReceivedSinceLastUpdate >= 1 || timeSinceLastUpdate >= 500;
            updateDelay = document.hidden ? 1000 : 25;
        }
        
        if (shouldUpdate) {
            this.scheduleCountUpdate(updateDelay);
        }
    }

    // Enhanced scheduling with adaptive delay
    scheduleCountUpdate(delay = 50) {
        // Cancel any pending update
        if (this.countUpdateThrottle) {
            clearTimeout(this.countUpdateThrottle);
        }
        
        // If we already have a pending update that's about to fire, don't schedule another
        if (this.pendingCountUpdate) {
            return;
        }
        
        this.pendingCountUpdate = true;
        
        this.countUpdateThrottle = setTimeout(() => {
            this.updateMessageCountDisplay();
            this.countUpdateThrottle = null;
            this.pendingCountUpdate = false;
            this.messagesReceivedSinceLastUpdate = 0;
            this.lastUpdateTime = Date.now();
        }, delay);
    }

    updateRateDisplay() {
        const messageCountArea = this.messageDetails.querySelector('.message-count-area');
        if (messageCountArea) {
            const rateText = messageCountArea.querySelector('.rate-text');
            if (rateText) {
                const rate = Math.round(this.messageReceiveRate * 10) / 10;
                const peakRate = this.dbManager ? this.dbManager.getTopicPeakRate(this.currentConnection.id, this.currentTopic) : 0;
                
                let rateDisplay = '';
                let color = '#6c757d';
                
                if (rate >= 1000) {
                    rateDisplay = `${(rate / 1000).toFixed(1)}k msg/sec`;
                    color = '#dc3545';
                } else if (rate >= 100) {
                    rateDisplay = `${Math.round(rate)} msg/sec`;
                    color = '#fd7e14';
                } else if (rate >= 10) {
                    rateDisplay = `${rate.toFixed(1)} msg/sec`;
                    color = '#ffc107';
                } else if (rate >= 1) {
                    rateDisplay = `${rate.toFixed(1)} msg/sec`;
                    color = '#28a745';
                } else if (rate > 0) {
                    rateDisplay = `${rate.toFixed(1)} msg/sec`;
                    color = '#6c757d';
                } else {
                    rateDisplay = '0 msg/sec';
                    color = '#6c757d';
                }
                
                // Add peak rate if available and significantly different
                if (peakRate > rate * 1.5) {
                    const peakDisplay = peakRate >= 1000 ? (peakRate/1000).toFixed(1)+'k' : Math.round(peakRate);
                    rateDisplay += ` (peak: ${peakDisplay})`;
                }
                
                rateText.textContent = rateDisplay;
                rateText.style.color = color;
                rateText.style.fontWeight = rate > 0 ? '500' : '400';
            }
        }
    }

    // Enhanced message count display using background count
    updateMessageCountDisplay() {
        try {
            const messageCountArea = this.messageDetails.querySelector('.message-count-area');
            
            if (messageCountArea) {
                // Use background count if available
                const displayCount = this.backgroundMessageCount > 0 ? this.backgroundMessageCount : this.getTopicMessageCount();
                
                if (displayCount !== this.lastDisplayedCount) {
                    const countText = messageCountArea.querySelector('.count-text');
                    if (countText) {
                        countText.textContent = `${displayCount} messages`;
                        
                        // Visual feedback for high-rate updates
                        if (this.messageReceiveRate > 10 && !document.hidden) {
                            countText.style.transition = 'color 0.2s';
                            countText.style.color = '#007bff';
                            setTimeout(() => {
                                countText.style.color = '#495057';
                            }, 200);
                        }
                    }
                    this.lastDisplayedCount = displayCount;
                }
                
                // Always update rate display
                this.updateRateDisplay();
            }
        } catch (error) {
            console.warn('Error updating message count:', error);
        }
    }

    // Method to manually refresh the message count (called externally)
    refreshMessageCount() {
        // Force immediate update
        if (this.countUpdateThrottle) {
            clearTimeout(this.countUpdateThrottle);
            this.countUpdateThrottle = null;
            this.pendingCountUpdate = false;
        }
        this.updateMessageCountDisplay();
        this.messagesReceivedSinceLastUpdate = 0;
        this.lastUpdateTime = Date.now();
    }

    limitDisplayedMessages() {
        const messageItems = this.messageDetails.querySelectorAll('.message-item');
        if (messageItems.length > this.maxDisplayMessages) {
            // Remove oldest messages (from the end since newest are at the top)
            for (let i = this.maxDisplayMessages; i < messageItems.length; i++) {
                messageItems[i].remove();
            }
        }
    }

    showExportMenu() {
        const exportBtn = this.messageDetails.querySelector('.export-btn');
        if (!exportBtn) return;
        
        // Create dropdown menu
        const dropdown = document.createElement('div');
        dropdown.className = 'export-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
            min-width: 120px;
        `;
        
        dropdown.innerHTML = `
            <div onclick="messagePanel.exportMessages('json')" 
                 style="padding: 10px 15px; cursor: pointer; border-bottom: 1px solid #eee; color: black;">
                JSON
            </div>
            <div onclick="messagePanel.exportMessages('csv')" 
                 style="padding: 10px 15px; cursor: pointer; color: black;">
                CSV
            </div>
        `;
        
        // Position relative to button
        exportBtn.style.position = 'relative';
        exportBtn.appendChild(dropdown);
        
        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!exportBtn.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeDropdown);
        }, 0);
    }

    // Create static header that won't be regenerated
    createTopicHeader(topic) {
        const formattedTopic = this.formatTopicPath(topic);
        
        // Common button style
        const buttonStyle = `
            padding: 8px 16px; 
            font-size: 14px; 
            border-radius: 6px; 
            background: #6c757d; 
            color: white; 
            border: none; 
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background-color 0.2s;
        `;

        const headerHTML = `
            <div class="topic-info" style="background: #f8f9fa; padding: 10px 15px; border-radius: 8px; margin-bottom: 10px;">
                <div class="topic-path" style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px;">
                    <div style="display: flex; align-items: flex-start; gap: 15px; flex: 1;">
                        <pre style="font-weight: bold; font-size: 16px; margin: 0; font-family: inherit; white-space: pre-wrap; word-break: break-word; flex: 1;">${escapeHtml(formattedTopic)}</pre>
                        <button class="copy-topic-btn" 
                                title="Copy topic name to clipboard"
                                style="${buttonStyle}; flex-shrink: 0;">
                            <span style="color: white;">▢</span> Copy Topic
                        </button>
                    </div>
                </div>
                
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
                    <button class="export-btn" 
                            title="Export messages"
                            style="${buttonStyle}"
                            onmouseover="this.style.background='#5a6268'" 
                            onmouseout="this.style.background='#6c757d'">
                        <span style="color: white;">⬇</span> Export
                    </button>
                    
                    <button class="clear-btn"
                            title="Clear all messages for this topic"
                            style="${buttonStyle.replace('#6c757d', '#dc3545')}"
                            onmouseover="this.style.background='#c82333'" 
                            onmouseout="this.style.background='#dc3545'">
                        <span style="color: white;">✕</span> Clear
                    </button>
                    
                    <button class="auto-scroll-btn" 
                            title="Toggle auto-scroll for new messages"
                            style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 20px; cursor: pointer; padding: 6px 12px; display: flex; align-items: center; gap: 8px; font-size: 14px;">
                        <div class="toggle-slider" style="width: 32px; height: 16px; background: #ccc; border-radius: 8px; position: relative; transition: background 0.3s;">
                            <div style="width: 12px; height: 12px; background: white; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>
                        </div>
                        <span class="toggle-label">Auto-scroll OFF</span>
                    </button>
                </div>
            </div>
        `;

        return headerHTML;
    }

    // Create separate message count area with rate display
    createMessageCountArea() {
        return `
            <div class="message-count-area" style="background: #e9ecef; padding: 8px 15px; border-radius: 6px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 20px; border: 1px solid #dee2e6;">
                <span class="count-text" style="font-size: 14px; color: #495057; font-weight: 500;">
                    0 messages
                </span>
                <span class="rate-separator" style="color: #6c757d; font-size: 12px;">•</span>
                <span class="rate-text" style="font-size: 13px; color: #6c757d; font-weight: 400;">
                    0 msg/sec
                </span>
            </div>
        `;
    }

    // Setup event listeners for the header buttons
    setupHeaderEventListeners() {
        const copyBtn = this.messageDetails.querySelector('.copy-topic-btn');
        const exportBtn = this.messageDetails.querySelector('.export-btn');
        const clearBtn = this.messageDetails.querySelector('.clear-btn');
        const autoScrollBtn = this.messageDetails.querySelector('.auto-scroll-btn');

        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyTopicName());
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.showExportMenu());
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearMessages());
        }

        if (autoScrollBtn) {
            autoScrollBtn.addEventListener('click', () => this.toggleAutoScroll());
        }
    }

    // Render only the message list without touching the header
    renderMessageList(messages) {
        const messageLog = this.messageDetails.querySelector('.message-log');
        if (!messageLog) return;

        messageLog.innerHTML = messages.map(msg => `
            <div class="message-item">
                <div class="message-timestamp">${formatTimestamp(msg.timestamp)}</div>
                <div class="message-value">${escapeHtml(msg.value || msg.message || '')}</div>
            </div>
        `).join('');
    }

    async showTopicMessages(topic, connection = null) {
        this.currentTopic = topic;
        this.currentConnection = connection;
        this.currentPage = 0;
        this.currentMessages = [];
        this.messageCount = 0;
        this.backgroundMessageCount = 0;
        this.lastCountUpdate = Date.now();
        this.userScrolledAway = false;
        this.headerCreated = false;
        this.lastDisplayedCount = 0;
        
        // Reset adaptive throttling state
        this.pendingCountUpdate = false;
        this.messagesReceivedSinceLastUpdate = 0;
        this.lastUpdateTime = 0;
        this.messageTimestamps = [];
        
        // Load rate history for this topic
        if (this.dbManager) {
            this.messageReceiveRate = this.dbManager.getTopicMessageRate(connection.id, topic);
        }

        if (!connection || !topic) {
            this.showNoSelection();
            return;
        }

        if (!this.isDbReady || !this.dbManager) {
            this.showError(topic, 'Database initializing...');
            
            try {
                await this.initializeDbManager();
            } catch (error) {
                console.error('MessagePanel: Failed to initialize database:', error);
                this.showError(topic, `Database initialization failed: ${error.message}`);
                return;
            }
        }

        try {
            const messages = await this.dbManager.getTopicMessages(
                connection.id, 
                topic, 
                this.messagesPerPage, 
                0
            );
            
            this.currentMessages = messages;
            this.messageCount = messages.length;
            this.backgroundMessageCount = messages.length;
            this.renderMessages(topic, messages, true);
            
            // Update from database metadata
            this.updateMessageCountFromDatabase();
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showError(topic, error.message);
        }
    }

    async loadMoreMessages() {
        if (!this.currentTopic || !this.currentConnection) return;
        
        if (!this.isDbReady || !this.dbManager) {
            return;
        }
        
        try {
            this.currentPage++;
            const newMessages = await this.dbManager.getTopicMessages(
                this.currentConnection.id,
                this.currentTopic,
                this.messagesPerPage,
                this.currentPage * this.messagesPerPage
            );
            
            if (newMessages.length > 0) {
                this.currentMessages = [...this.currentMessages, ...newMessages];
                // Only re-render the message list, not the header
                this.renderMessageList(this.currentMessages);
            }
        } catch (error) {
            console.error('Error loading more messages:', error);
        }
    }

    showNoSelection() {
        this.messageDetails.innerHTML = `
            <div class="no-topic-selected">
                Select a topic from the tree to view message history
            </div>
        `;
        this.headerCreated = false;
    }

    showError(topic, errorMessage = 'Unknown error') {
        this.messageDetails.innerHTML = `
            <div class="no-topic-selected">
                Error loading messages for topic: ${escapeHtml(topic)}<br>
                <small style="color: #dc3545;">${escapeHtml(errorMessage)}</small>
            </div>
        `;
        this.headerCreated = false;
    }

    renderMessages(topic, messages, resetScroll = true) {
        const scrollTop = resetScroll ? 0 : this.messageDetails.scrollTop;
        
        // Only create header once per topic - never recreate it
        if (!this.headerCreated) {
            this.messageDetails.innerHTML = 
                this.createTopicHeader(topic) + 
                this.createMessageCountArea() + 
                '<div class="message-log"></div>';
            this.setupHeaderEventListeners();
            this.headerCreated = true;
            setTimeout(() => this.updateAutoScrollButton(), 0);
        }
        
        // Always update the message list
        this.renderMessageList(messages);
        
        // Update the count after rendering
        setTimeout(() => this.updateMessageCountDisplay(), 0);
        
        if (!resetScroll) {
            this.messageDetails.scrollTop = scrollTop;
        } else {
            this.userScrolledAway = false;
        }
    }

    async exportMessages(format) {
        if (!this.currentTopic || !this.currentConnection || !this.isDbReady || !this.dbManager) {
            console.warn('No topic selected for export or database not ready');
            return;
        }

        // Close dropdown if open
        const dropdown = this.messageDetails.querySelector('.export-dropdown');
        if (dropdown) {
            dropdown.remove();
        }

        try {
            const allMessages = await this.dbManager.getTopicMessages(
                this.currentConnection.id,
                this.currentTopic,
                10000,
                0
            );

            let exportData;

            switch (format) {
                case 'json':
                    exportData = JSON.stringify({
                        topic: this.currentTopic,
                        connection: this.currentConnection.name,
                        exportedAt: new Date().toISOString(),
                        messages: allMessages
                    }, null, 2);
                    break;
                case 'csv':
                    const csvHeader = 'Timestamp,Topic,Message\n';
                    const csvRows = allMessages.map(msg => 
                        `"${msg.timestamp}","${this.currentTopic}","${(msg.value || msg.message || '').replace(/"/g, '""')}"`
                    ).join('\n');
                    exportData = csvHeader + csvRows;
                    break;
                default:
                    console.warn('Unknown export format:', format);
                    return;
            }

            const blob = new Blob([exportData], { type: format === 'json' ? 'application/json' : 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.currentTopic.replace(/\//g, '_')}_messages.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting messages:', error);
        }
    }

    async clearMessages() {
        if (!this.currentTopic || !this.currentConnection || !this.isDbReady || !this.dbManager) {
            return;
        }

        if (!confirm(`Are you sure you want to clear all messages for topic "${this.currentTopic}"?`)) {
            return;
        }

        try {
            // Clear messages from database
            await this.dbManager.clearTopicMessages(this.currentConnection.id, this.currentTopic);
            
            // Reset counters and reload
            this.messageCount = 0;
            this.backgroundMessageCount = 0;
            this.currentMessages = [];
            this.currentPage = 0;
            this.lastDisplayedCount = 0;
            
            // Only refresh the message list, not the entire display
            this.renderMessageList([]);
            this.updateMessageCountDisplay();
            
            // Emit event for other components
            this.emit('messages-cleared', { topic: this.currentTopic });
            
            console.log(`Cleared messages for topic: ${this.currentTopic}`);
        } catch (error) {
            console.error('Error clearing messages:', error);
            alert('Failed to clear messages. Please try again.');
        }
    }

    clear() {
        this.currentTopic = null;
        this.currentConnection = null;
        this.currentMessages = [];
        this.currentPage = 0;
        this.messageCount = 0;
        this.backgroundMessageCount = 0;
        this.userScrolledAway = false;
        this.autoScrollEnabled = false;
        this.headerCreated = false;
        this.lastDisplayedCount = 0;
        
        // Reset rate tracking
        this.pendingCountUpdate = false;
        this.messagesReceivedSinceLastUpdate = 0;
        this.lastUpdateTime = 0;
        this.messageReceiveRate = 0;
        this.messageTimestamps = [];
        
        if (this.updateThrottle) {
            clearTimeout(this.updateThrottle);
            this.updateThrottle = null;
        }
        
        if (this.countUpdateThrottle) {
            clearTimeout(this.countUpdateThrottle);
            this.countUpdateThrottle = null;
        }
        
        // Clean up continuous rate tracking
        if (this.rateUpdateInterval) {
            clearInterval(this.rateUpdateInterval);
            this.rateUpdateInterval = null;
        }
        
        this.showNoSelection();
        
        // Restart continuous tracking
        this.startContinuousRateTracking();
    }
}

module.exports = MessagePanel;