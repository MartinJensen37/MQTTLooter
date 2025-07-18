class MessageTemplateService {
  constructor() {
    this.templates = this.loadTemplates();
  }

  loadTemplates() {
    try {
      const saved = localStorage.getItem('mqtt-message-templates');
      return saved ? JSON.parse(saved) : this.getDefaultTemplates();
    } catch (error) {
      console.error('Failed to load message templates:', error);
      return this.getDefaultTemplates();
    }
  }

  saveTemplates() {
    localStorage.setItem('mqtt-message-templates', JSON.stringify(this.templates));
  }

  getDefaultTemplates() {
    return {
      'temperature-sensor': {
        id: 'temperature-sensor',
        name: 'Temperature Sensor',
        topic: 'sensors/temperature/{{sensorId}}',
        payload: JSON.stringify({
          temperature: '{{randomFloat(15, 35, 1)}}',
          humidity: '{{randomFloat(30, 80, 1)}}',
          timestamp: '{{timestamp}}',
          sensorId: '{{sensorId}}'
        }, null, 2),
        qos: 0,
        retain: false,
        category: 'IoT Sensors',
        variables: {
          sensorId: { type: 'text', default: 'temp-001', description: 'Sensor identifier' }
        }
      },
      'device-status': {
        id: 'device-status',
        name: 'Device Status',
        topic: 'devices/{{deviceId}}/status',
        payload: JSON.stringify({
          status: '{{randomChoice("online", "offline", "maintenance")}}',
          lastSeen: '{{timestamp}}',
          batteryLevel: '{{randomInt(0, 100)}}',
          firmwareVersion: '1.2.3'
        }, null, 2),
        qos: 1,
        retain: true,
        category: 'Device Management'
      },
      'gps-location': {
        id: 'gps-location',
        name: 'GPS Location',
        topic: 'tracking/{{vehicleId}}/location',
        payload: JSON.stringify({
          latitude: '{{randomFloat(-90, 90, 6)}}',
          longitude: '{{randomFloat(-180, 180, 6)}}',
          speed: '{{randomFloat(0, 120, 1)}}',
          heading: '{{randomInt(0, 360)}}',
          timestamp: '{{timestamp}}'
        }, null, 2),
        qos: 0,
        retain: false,
        category: 'Location Services'
      }
    };
  }

  getAllTemplates() {
    return Object.values(this.templates);
  }

  getTemplate(id) {
    return this.templates[id];
  }

  saveTemplate(template) {
    this.templates[template.id] = {
      ...template,
      createdAt: template.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    this.saveTemplates();
    return this.templates[template.id];
  }

  deleteTemplate(id) {
    if (this.templates[id]) {
      delete this.templates[id];
      this.saveTemplates();
      return true;
    }
    return false;
  }

  // Template variable replacement
  processTemplate(template, variables = {}) {
    let processedTopic = template.topic;
    let processedPayload = template.payload;

    // Replace variables in topic and payload
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processedTopic = processedTopic.replace(regex, value);
      processedPayload = processedPayload.replace(regex, value);
    });

    // Process built-in functions
    processedTopic = this.processFunctions(processedTopic);
    processedPayload = this.processFunctions(processedPayload);

    return {
      topic: processedTopic,
      payload: processedPayload,
      qos: template.qos,
      retain: template.retain,
      properties: template.properties
    };
  }

  processFunctions(text) {
    // {{timestamp}} - Current timestamp
    text = text.replace(/{{timestamp}}/g, () => Date.now());
    
    // {{randomInt(min, max)}} - Random integer
    text = text.replace(/{{randomInt\((\d+),\s*(\d+)\)}}/g, (match, min, max) => {
      return Math.floor(Math.random() * (parseInt(max) - parseInt(min) + 1)) + parseInt(min);
    });
    
    // {{randomFloat(min, max, decimals)}} - Random float
    text = text.replace(/{{randomFloat\(([\d.-]+),\s*([\d.-]+),\s*(\d+)\)}}/g, (match, min, max, decimals) => {
      const value = Math.random() * (parseFloat(max) - parseFloat(min)) + parseFloat(min);
      return value.toFixed(parseInt(decimals));
    });
    
    // {{randomChoice("option1", "option2", ...)}} - Random choice
    text = text.replace(/{{randomChoice\((.*?)\)}}/g, (match, options) => {
      const choices = options.split(',').map(s => s.trim().replace(/['"]/g, ''));
      return choices[Math.floor(Math.random() * choices.length)];
    });
    
    // {{uuid}} - Generate UUID
    text = text.replace(/{{uuid}}/g, () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    });

    return text;
  }

  getCategories() {
    const categories = new Set();
    Object.values(this.templates).forEach(template => {
      if (template.category) {
        categories.add(template.category);
      }
    });
    return Array.from(categories).sort();
  }
}

export default MessageTemplateService;