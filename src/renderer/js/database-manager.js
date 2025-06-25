class DatabaseManager {
    constructor() {
        this.db = null;
        this.dbName = 'MQTTLooterDB';
        this.dbVersion = 2; // Changed from 1 to 2 to force upgrade
        this.isInitialized = false;
        this.messageQueue = []; // Queue for batching messages
        this.isProcessingQueue = false;
        this.batchTimeout = null;
        this.BATCH_SIZE = 50; // Process messages in batches
        this.BATCH_DELAY = 100; // Wait 100ms before processing batch
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
                console.log('Available object stores:', Array.from(this.db.objectStoreNames));
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('Upgrading database from version', event.oldVersion, 'to', event.newVersion);

                // Delete existing stores if they exist (for clean upgrade)
                if (db.objectStoreNames.contains('messages')) {
                    db.deleteObjectStore('messages');
                    console.log('Deleted existing messages store');
                }
                if (db.objectStoreNames.contains('topicMetadata')) {
                    db.deleteObjectStore('topicMetadata');
                    console.log('Deleted existing topicMetadata store');
                }

                // Create messages store
                console.log('Creating messages object store...');
                const messagesStore = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                messagesStore.createIndex('connectionId', 'connectionId', { unique: false });
                messagesStore.createIndex('topic', 'topic', { unique: false });
                messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
                messagesStore.createIndex('connectionTopic', ['connectionId', 'topic'], { unique: false });
                console.log('Messages store created with indexes');

                // Create metadata store for topic summaries
                console.log('Creating topicMetadata object store...');
                const metadataStore = db.createObjectStore('topicMetadata', { keyPath: 'id' });
                metadataStore.createIndex('connectionId', 'connectionId', { unique: false });
                console.log('TopicMetadata store created with indexes');

                console.log('Database upgrade completed');
            };
        });
    }

    // Add message to queue for batch processing
    async addMessage(connectionId, topic, message) {
        console.log('Adding message:', { connectionId, topic, message });

        if (!this.isInitialized) {
            console.error('Database not initialized');
            throw new Error('Database not initialized');
        }

        // Verify object stores exist
        if (!this.db.objectStoreNames.contains('messages') || !this.db.objectStoreNames.contains('topicMetadata')) {
            console.error('Required object stores not found:', Array.from(this.db.objectStoreNames));
            throw new Error('Database object stores not found');
        }

        const messageData = {
            connectionId,
            topic,
            message,
            timestamp: new Date().toISOString()
        };

        // Add to queue
        this.messageQueue.push(messageData);

        // Start processing if not already processing
        if (!this.isProcessingQueue) {
            this.scheduleQueueProcessing();
        }

        return messageData;
    }

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
            // Process messages in batches
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

    async processBatch(messages) {
        return new Promise((resolve, reject) => {
            // Verify stores exist before creating transaction
            if (!this.db.objectStoreNames.contains('messages') || !this.db.objectStoreNames.contains('topicMetadata')) {
                console.error('Object stores not found for transaction');
                reject(new Error('Object stores not found'));
                return;
            }

            const transaction = this.db.transaction(['messages', 'topicMetadata'], 'readwrite');
            const messagesStore = transaction.objectStore('messages');
            const metadataStore = transaction.objectStore('topicMetadata');

            let completed = 0;
            const total = messages.length;

            transaction.oncomplete = () => {
                console.log(`Batch processed: ${total} messages`);
                resolve();
            };

            transaction.onerror = () => {
                console.error('Batch transaction failed:', transaction.error);
                reject(transaction.error);
            };

            // Process each message in the batch
            for (const messageData of messages) {
                // Add message
                const messageRequest = messagesStore.add(messageData);
                
                messageRequest.onsuccess = () => {
                    completed++;
                    
                    // Update metadata for this topic
                    const metadataId = `${messageData.connectionId}:${messageData.topic}`;
                    const metadataRequest = metadataStore.get(metadataId);
                    
                    metadataRequest.onsuccess = () => {
                        const metadata = metadataRequest.result || {
                            id: metadataId,
                            connectionId: messageData.connectionId,
                            topic: messageData.topic,
                            messageCount: 0,
                            lastMessage: null,
                            lastTimestamp: null
                        };

                        metadata.messageCount++;
                        metadata.lastMessage = messageData.message;
                        metadata.lastTimestamp = messageData.timestamp;

                        metadataStore.put(metadata);
                    };
                };

                messageRequest.onerror = () => {
                    console.error('Error adding message:', messageRequest.error);
                };
            }
        });
    }

    async getTopicMessages(connectionId, topic, limit = 100, offset = 0) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        // Verify stores exist
        if (!this.db.objectStoreNames.contains('messages')) {
            throw new Error('Messages object store not found');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages'], 'readonly');
            const store = transaction.objectStore('messages');
            const index = store.index('connectionTopic');
            const range = IDBKeyRange.only([connectionId, topic]);
            const request = index.openCursor(range, 'prev'); // Get newest first

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

        // Verify stores exist
        if (!this.db.objectStoreNames.contains('topicMetadata')) {
            throw new Error('TopicMetadata object store not found');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['topicMetadata'], 'readonly');
            const store = transaction.objectStore('topicMetadata');
            const request = store.get(metadataId);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async clearConnectionData(connectionId) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['messages', 'topicMetadata'], 'readwrite');
            
            // Clear messages
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

            // Clear metadata
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
                console.log('Connection data cleared for:', connectionId);
                resolve();
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };
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