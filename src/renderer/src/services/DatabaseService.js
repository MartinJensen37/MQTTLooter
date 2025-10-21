class DatabaseService {
  constructor() {
    this.db = null;
    this.dbName = 'MQTTLooterDB';
    this.dbVersion = 1;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
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
        
        // Delete existing stores if they exist
        if (db.objectStoreNames.contains('messages')) {
          db.deleteObjectStore('messages');
        }
        if (db.objectStoreNames.contains('topicMetadata')) {
          db.deleteObjectStore('topicMetadata');
        }

        // Create messages store
        const messagesStore = db.createObjectStore('messages', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        messagesStore.createIndex('connectionId', 'connectionId', { unique: false });
        messagesStore.createIndex('topic', 'topic', { unique: false });
        messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
        messagesStore.createIndex('connectionTopic', ['connectionId', 'topic'], { unique: false });

        // Create metadata store
        const metadataStore = db.createObjectStore('topicMetadata', { keyPath: 'id' });
        metadataStore.createIndex('connectionId', 'connectionId', { unique: false });
      };
    });
  }

  async addMessage(connectionId, topic, message) {
    if (!this.isInitialized) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readwrite');
      const store = transaction.objectStore('messages');
      
      const messageData = {
        connectionId,
        topic,
        message,
        timestamp: Date.now()
      };

      const request = store.add(messageData);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getTopicMessages(connectionId, topic, limit = 100, offset = 0) {
    if (!this.isInitialized) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('connectionTopic');
      
      const request = index.getAll([connectionId, topic]);

      request.onsuccess = () => {
        const messages = request.result
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(offset, offset + limit);
        resolve(messages);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getAllMessagesForConnection(connectionId) {
    if (!this.isInitialized) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('connectionId');
      
      const request = index.getAll(connectionId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearConnectionData(connectionId) {
    if (!this.isInitialized) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readwrite');
      const store = transaction.objectStore('messages');
      const index = store.index('connectionId');
      
      const request = index.openCursor(connectionId);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }
}

export default new DatabaseService();