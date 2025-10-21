class ConnectionProfileService {
  constructor() {
    this.profiles = this.loadProfiles();
  }

  loadProfiles() {
    try {
      const saved = localStorage.getItem('mqtt-connection-profiles');
      return saved ? JSON.parse(saved) : this.getDefaultProfiles();
    } catch (error) {
      console.error('Failed to load connection profiles:', error);
      return this.getDefaultProfiles();
    }
  }

  saveProfiles() {
    localStorage.setItem('mqtt-connection-profiles', JSON.stringify(this.profiles));
  }

  getDefaultProfiles() {
    return {
      'local-mosquitto': {
        id: 'local-mosquitto',
        name: 'Local Mosquitto',
        brokerUrl: 'mqtt://localhost:1883',
        protocolVersion: 4,
        clean: true,
        keepalive: 60,
        connectTimeout: 30000,
        description: 'Local Mosquitto broker with default settings'
      },
      'local-mosquitto-v5': {
        id: 'local-mosquitto-v5',
        name: 'Local Mosquitto (MQTT 5.0)',
        brokerUrl: 'mqtt://localhost:1883',
        protocolVersion: 5,
        clean: true,
        keepalive: 60,
        connectTimeout: 30000,
        properties: {
          sessionExpiryInterval: 0,
          receiveMaximum: 65535
        },
        description: 'Local Mosquitto broker with MQTT 5.0'
      },
      'hivemq-public': {
        id: 'hivemq-public',
        name: 'HiveMQ Public',
        brokerUrl: 'mqtt://broker.hivemq.com:1883',
        protocolVersion: 4,
        clean: true,
        keepalive: 60,
        description: 'HiveMQ public test broker'
      },
      'eclipse-public': {
        id: 'eclipse-public',
        name: 'Eclipse Public',
        brokerUrl: 'mqtt://mqtt.eclipseprojects.io:1883',
        protocolVersion: 4,
        clean: true,
        keepalive: 60,
        description: 'Eclipse IoT public broker'
      }
    };
  }

  getAllProfiles() {
    return Object.values(this.profiles);
  }

  getProfile(id) {
    return this.profiles[id];
  }

  saveProfile(profile) {
    this.profiles[profile.id] = {
      ...profile,
      createdAt: profile.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    this.saveProfiles();
    return this.profiles[profile.id];
  }

  deleteProfile(id) {
    if (this.profiles[id]) {
      delete this.profiles[id];
      this.saveProfiles();
      return true;
    }
    return false;
  }

  createFromConnection(connection) {
    const profile = {
      id: `profile-${Date.now()}`,
      name: `${connection.name} Profile`,
      ...connection,
      description: `Profile created from connection: ${connection.name}`
    };
    return this.saveProfile(profile);
  }
}

export default ConnectionProfileService;