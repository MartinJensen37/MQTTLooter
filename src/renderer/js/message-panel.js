const EventEmitter = require('events');
const path = require('path');
const { escapeHtml, formatTimestamp } = require(path.join(__dirname, 'utils.js'));

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
        this.userScrolledAway = false;
        this.autoScrollEnabled = false;
        this.headerCreated = false;
        
        // Simple throttling for display updates
        this.displayUpdateThrottle = null;
        this.messageReceiveRate = 0;
        this.messageTimestamps = [];
        this.rateCalculationWindow = 5000; // 5 seconds
        
        this.setupEventHandlers();
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

    // Get message count directly from topic tree (single source of truth)
    getCurrentMessageCount() {
        if (!this.currentTopic || !this.currentConnection || !this.topicTree) {
            return 0;
        }
        
        return this.topicTree.getTopicMessageCount(this.currentConnection.id, this.currentTopic);
    }

    formatTopicPath(topic, maxLength = 60) {
        if (topic.length <= maxLength) {
            return topic;
        }
        
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

    refreshWhenVisible() {
        console.log('MessagePanel: Refreshing when visible');
        
        if (this.currentTopic && this.currentConnection) {
            this.updateDisplay();
            this.loadLatestMessages();
        }
    }

    async loadLatestMessages() {
        if (!this.currentTopic || !this.currentConnection || !this.isDbReady) return;
        
        try {
            const currentCount = this.getCurrentMessageCount();
            if (currentCount > this.currentMessages.length) {
                console.log(`Found ${currentCount - this.currentMessages.length} new messages while window was hidden`);
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

    // Simplified update method - just updates display when called
    updateIfSelected(topic, message) {
        if (this.currentTopic === topic && this.currentConnection) {
            // Track message rate
            this.trackMessageRate();
            
            // Throttled display update
            this.scheduleDisplayUpdate(message);
        }
    }

    trackMessageRate() {
        const now = Date.now();
        this.messageTimestamps.push(now);
        this.messageTimestamps = this.messageTimestamps.filter(ts => now - ts < this.rateCalculationWindow);
        this.messageReceiveRate = this.messageTimestamps.length / (this.rateCalculationWindow / 1000);
    }

    scheduleDisplayUpdate(message = null) {
        if (this.displayUpdateThrottle) {
            clearTimeout(this.displayUpdateThrottle);
        }
        
        // Adaptive delay based on message rate
        let delay = 50;
        if (this.messageReceiveRate > 50) delay = 200;
        else if (this.messageReceiveRate > 20) delay = 100;
        else if (this.messageReceiveRate > 5) delay = 75;
        
        this.displayUpdateThrottle = setTimeout(() => {
            this.updateDisplay();
            if (message && !document.hidden && this.headerCreated) {
                this.appendNewMessage(message);
            }
            this.displayUpdateThrottle = null;
        }, delay);
    }

    updateDisplay() {
        // Update count display
        const messageCountArea = this.messageDetails.querySelector('.message-count-area');
        if (messageCountArea) {
            const countText = messageCountArea.querySelector('.count-text');
            const rateText = messageCountArea.querySelector('.rate-text');
            
            if (countText) {
                const count = this.getCurrentMessageCount();
                countText.textContent = `${count} messages`;
            }
            
            if (rateText) {
                this.updateRateDisplay(rateText);
            }
        }
    }

    updateRateDisplay(rateText) {
        const rate = Math.round(this.messageReceiveRate * 10) / 10;
        
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
        
        rateText.textContent = rateDisplay;
        rateText.style.color = color;
        rateText.style.fontWeight = rate > 0 ? '500' : '400';
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
        this.limitDisplayedMessages();
        
        if (this.autoScrollEnabled) {
            messageElement.scrollIntoView({ 
                behavior: 'instant', 
                block: 'start',
                inline: 'nearest'
            });
        }
    }

    limitDisplayedMessages() {
        const messageItems = this.messageDetails.querySelectorAll('.message-item');
        if (messageItems.length > this.maxDisplayMessages) {
            for (let i = this.maxDisplayMessages; i < messageItems.length; i++) {
                messageItems[i].remove();
            }
        }
    }

    showExportMenu() {
        const exportBtn = this.messageDetails.querySelector('.export-btn');
        if (!exportBtn) return;
        
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
        
        exportBtn.style.position = 'relative';
        exportBtn.appendChild(dropdown);
        
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

    createTopicHeader(topic) {
        const formattedTopic = this.formatTopicPath(topic);
        
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
        this.userScrolledAway = false;
        this.headerCreated = false;
        this.messageTimestamps = [];
        this.messageReceiveRate = 0;

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
            this.renderMessages(topic, messages, true);
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
        
        if (!this.headerCreated) {
            this.messageDetails.innerHTML = 
                this.createTopicHeader(topic) + 
                this.createMessageCountArea() + 
                '<div class="message-log"></div>';
            this.setupHeaderEventListeners();
            this.headerCreated = true;
            setTimeout(() => this.updateAutoScrollButton(), 0);
        }
        
        this.renderMessageList(messages);
        this.updateDisplay();
        
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
            await this.dbManager.clearTopicMessages(this.currentConnection.id, this.currentTopic);
            
            this.currentMessages = [];
            this.currentPage = 0;
            
            this.renderMessageList([]);
            this.updateDisplay();
            
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
        this.userScrolledAway = false;
        this.autoScrollEnabled = false;
        this.headerCreated = false;
        this.messageTimestamps = [];
        this.messageReceiveRate = 0;
        
        if (this.updateThrottle) {
            clearTimeout(this.updateThrottle);
            this.updateThrottle = null;
        }
        
        if (this.displayUpdateThrottle) {
            clearTimeout(this.displayUpdateThrottle);
            this.displayUpdateThrottle = null;
        }
        
        this.showNoSelection();
    }
}

module.exports = MessagePanel;