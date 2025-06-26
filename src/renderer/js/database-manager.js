class DatabaseManager {
    constructor() {
        this.db = null;
        this.dbName = 'MQTTLooterDB';
        this.dbVersion = 3; // Increment for new rate tracking features
        this.isInitialized = false;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.batchTimeout = null;
        this.BATCH_SIZE = 50;
        this.BATCH_DELAY = 100;
        
        // Enhanced rate tracking that persists across window visibility changes
        this.topicRates = new Map(); // Store real-time rates
        this.rateUpdateInterval = null;
        this.startRateTracking();
    }

    startRateTracking() {
        // Update rates every 1 second, regardless of window visibility
        this.rateUpdateInterval = setInterval(() => {
            this.updateMessageRates();
        }, 1000);
    }

    updateMessageRates() {
        const now = Date.now();
        const windowSize = 10000; // 10 second window for rate calculation
        
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

    getAllTopicRates(connectionId) {
        const rates = {};
        for (const [topicId, data] of this.topicRates.entries()) {
            if (topicId.startsWith(`${connectionId}:`)) {
                const topic = topicId.substring(`${connectionId}:`.length);
                rates[topic] = {
                    current: data.rate,
                    peak: data.peakRate || 0,
                    peakTime: data.peakRateTime
                };
            }
        }
        return rates;
    }

    async init() {
        if (this.isInitialized) return;

        return new Promise((resolve, reject) => {
            console.log('Opening database...');
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Database error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                console.log('Database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('Upgrading database from version', event.oldVersion, 'to', event.newVersion);

                // Delete existing stores if they exist
                if (db.objectStoreNames.contains('messages')) {
                    db.deleteObjectStore('messages');
                }
                if (db.objectStoreNames.contains('topicMetadata')) {
                    db.deleteObjectStore('topicMetadata');
                }

                // Create messages store
                const messagesStore = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                messagesStore.createIndex('connectionId', 'connectionId', { unique: false });
                messagesStore.createIndex('topic', 'topic', { unique: false });
                messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
                messagesStore.createIndex('connectionTopic', ['connectionId', 'topic'], { unique: false });

                // Create enhanced metadata store with rate tracking
                const metadataStore = db.createObjectStore('topicMetadata', { keyPath: 'id' });
                metadataStore.createIndex('connectionId', 'connectionId', { unique: false });
            };
        });
    }

    async addMessage(connectionId, topic, message) {
        const topicId = `${connectionId}:${topic}`;
        
        // Track rate immediately
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
        
        // Continue with existing message processing
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        if (!this.db.objectStoreNames.contains('messages') || !this.db.objectStoreNames.contains('topicMetadata')) {
            throw new Error('Database object stores not found');
        }

        const messageData = {
            connectionId,
            topic,
            message,
            timestamp: new Date().toISOString()
        };

        this.messageQueue.push(messageData);

        if (!this.isProcessingQueue) {
            this.scheduleQueueProcessing();
        }

        return messageData;
    }

    // Rest of the methods remain the same but with enhanced metadata tracking
    async processBatch(messages) {
        return new Promise((resolve, reject) => {
            if (!this.db.objectStoreNames.contains('messages') || !this.db.objectStoreNames.contains('topicMetadata')) {
                reject(new Error('Object stores not found'));
                return;
            }

            const transaction = this.db.transaction(['messages', 'topicMetadata'], 'readwrite');
            const messagesStore = transaction.objectStore('messages');
            const metadataStore = transaction.objectStore('topicMetadata');

            let completed = 0;
            const total = messages.length;

            transaction.oncomplete = () => {
                resolve();
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };

            for (const messageData of messages) {
                const messageRequest = messagesStore.add(messageData);
                
                messageRequest.onsuccess = () => {
                    completed++;
                    
                    const metadataId = `${messageData.connectionId}:${messageData.topic}`;
                    const metadataRequest = metadataStore.get(metadataId);
                    
                    metadataRequest.onsuccess = () => {
                        const topicId = `${messageData.connectionId}:${messageData.topic}`;
                        const rateData = this.topicRates.get(topicId);
                        
                        const metadata = metadataRequest.result || {
                            id: metadataId,
                            connectionId: messageData.connectionId,
                            topic: messageData.topic,
                            messageCount: 0,
                            lastMessage: null,
                            lastTimestamp: null,
                            currentRate: 0,
                            peakRate: 0
                        };

                        metadata.messageCount++;
                        metadata.lastMessage = messageData.message;
                        metadata.lastTimestamp = messageData.timestamp;
                        
                        // Store rate information in metadata
                        if (rateData) {
                            metadata.currentRate = rateData.rate;
                            metadata.peakRate = Math.max(metadata.peakRate || 0, rateData.peakRate || 0);
                        }

                        metadataStore.put(metadata);
                    };
                };
            }
        });
    }

    // Keep the existing methods for backwards compatibility
    scheduleQueueProcessing() {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
        }

        this.batchTimeout = setTimeout(() => {
            this.processMessageQueue();
        }, this.BATCH_DELAY);
    }

    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            while (this.messageQueue.length > 0) {
                const batch = this.messageQueue.splice(0, this.BATCH_SIZE);
                await this.processBatch(batch);
            }
        } catch (error) {
            console.error('Error processing message queue:', error);
        } finally {
            this.isProcessingQueue = false;
        }
    }

    async getTopicMessages(connectionId, topic, limit = 100, offset = 0) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        if (!this.db.objectStoreNames.contains('messages')) {
            throw new Error('Messages object store not found');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readonly');
            const store = transaction.objectStore('messages');
            const index = store.index('connectionTopic');
            const range = IDBKeyRange.only([connectionId, topic]);
            const request = index.openCursor(range, 'prev');

            const messages = [];
            let skipped = 0;
            let collected = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && collected < limit) {
                    if (skipped < offset) {
                        skipped++;
                        cursor.continue();
                        return;
                    }

                    messages.push(cursor.value);
                    collected++;
                    cursor.continue();
                } else {
                    resolve(messages);
                }
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getTopicMetadata(metadataId) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        if (!this.db.objectStoreNames.contains('topicMetadata')) {
            throw new Error('TopicMetadata object store not found');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['topicMetadata'], 'readonly');
            const store = transaction.objectStore('topicMetadata');
            const request = store.get(metadataId);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Enhance with real-time rate data
                    const topicId = metadataId;
                    const rateData = this.topicRates.get(topicId);
                    if (rateData) {
                        result.currentRate = rateData.rate;
                        result.peakRate = Math.max(result.peakRate || 0, rateData.peakRate || 0);
                    }
                }
                resolve(result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    // Add cleanup method
    cleanup() {
        if (this.rateUpdateInterval) {
            clearInterval(this.rateUpdateInterval);
            this.rateUpdateInterval = null;
        }
    }

    // Rest of existing methods remain the same...
    async clearConnectionData(connectionId) {
        // Clear rate tracking for this connection
        for (const [topicId] of this.topicRates.entries()) {
            if (topicId.startsWith(`${connectionId}:`)) {
                this.topicRates.delete(topicId);
            }
        }

        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages', 'topicMetadata'], 'readwrite');
            
            const messagesStore = transaction.objectStore('messages');
            const messagesIndex = messagesStore.index('connectionId');
            const messagesRequest = messagesIndex.openCursor(IDBKeyRange.only(connectionId));
            
            messagesRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            const metadataStore = transaction.objectStore('topicMetadata');
            const metadataIndex = metadataStore.index('connectionId');
            const metadataRequest = metadataIndex.openCursor(IDBKeyRange.only(connectionId));
            
            metadataRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            transaction.oncomplete = () => {
                resolve();
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };
        });
    }

    async getAllMessagesForConnection(connectionId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readonly');
            const store = transaction.objectStore('messages');
            const index = store.index('connectionId');
            const request = index.getAll(connectionId);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllTopics(connectionId) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['topicMetadata'], 'readonly');
            const store = transaction.objectStore('topicMetadata');
            const index = store.index('connectionId');
            const request = index.getAll(connectionId);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }
}

module.exports = DatabaseManager;