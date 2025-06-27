const mqtt = require('mqtt');
const EventEmitter = require('events');

class MQTTClient extends EventEmitter {
    constructor(connection) {
        super();
        this.connection = connection;
        this.client = null;
        this.isConnected = false;
        this.hasError = false;
    }

    connect() {
        if (this.client) {
            this.disconnect();
        }

        const options = {
            clientId: this.connection.clientId,
            clean: true,
            reconnectPeriod: 5000,
            connectTimeout: 30000
        };

        if (this.connection.username) {
            options.username = this.connection.username;
        }

        if (this.connection.password) {
            options.password = this.connection.password;
        }

        this.client = mqtt.connect(this.connection.url, options);
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('connect', () => {
            console.log(`Connected to ${this.connection.name}`);
            this.isConnected = true;
            this.hasError = false;
            this.emit('connected');
            this.subscribeToTopics();
        });

        this.client.on('message', (topic, message) => {
            const msg = message.toString();
            this.emit('message', topic, msg);
        });

        this.client.on('error', (err) => {
            console.error(`MQTT connection error on ${this.connection.name}:`, err);
            this.isConnected = false;
            this.hasError = true;
            this.emit('error', err);
        });

        this.client.on('close', () => {
            console.log(`Connection closed: ${this.connection.name}`);
            this.isConnected = false;
            this.emit('disconnected');
        });

        this.client.on('reconnect', () => {
            console.log(`Reconnecting to ${this.connection.name}`);
            this.emit('reconnecting');
        });
    }

    subscribeToTopics() {
        if (!this.client || !this.isConnected) return;

        const topics = this.connection.subscriptionTopics || ['#'];
        topics.forEach(topic => {
            this.client.subscribe(topic, (err) => {
                if (err) {
                    console.error(`Failed to subscribe to ${topic}:`, err);
                } else {
                    console.log(`Subscribed to ${topic}`);
                }
            });
        });
    }

    disconnect(force = false) {
        console.log('Disconnecting MQTT client, force:', force);
        
        if (this.client) {
            try {
                // Disable reconnection before disconnecting
                if (this.client.options) {
                    this.client.options.reconnectPeriod = 0;
                    this.client.options.connectTimeout = 1000;
                }
                
                // Remove all listeners to prevent callbacks
                this.client.removeAllListeners();
                
                // Force end the connection
                this.client.end(force, () => {
                    console.log('MQTT client disconnected');
                });
                
                // Clear the client reference
                this.client = null;
                
            } catch (error) {
                console.warn('Error during MQTT disconnect:', error);
                this.client = null;
            }
        }
        
        // Emit disconnected event
        this.emit('disconnected');
    }

    publish(topic, message, options = {}) {
        if (!this.client || !this.isConnected) {
            throw new Error('Not connected to MQTT broker');
        }

        return new Promise((resolve, reject) => {
            this.client.publish(topic, message, options, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

module.exports = MQTTClient;