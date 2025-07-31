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
        },
        schema: {
          type: 'object',
          properties: {
            temperature: { type: 'number', minimum: -50, maximum: 100 },
            humidity: { type: 'number', minimum: 0, maximum: 100 },
            timestamp: { type: 'number' },
            sensorId: { type: 'string', minLength: 1 }
          },
          required: ['temperature', 'humidity', 'timestamp', 'sensorId']
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
        category: 'Device Management',
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['online', 'offline', 'maintenance'] },
            lastSeen: { type: 'number' },
            batteryLevel: { type: 'integer', minimum: 0, maximum: 100 },
            firmwareVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' }
          },
          required: ['status', 'lastSeen']
        }
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
        category: 'Location Services',
        schema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', minimum: -90, maximum: 90 },
            longitude: { type: 'number', minimum: -180, maximum: 180 },
            speed: { type: 'number', minimum: 0 },
            heading: { type: 'integer', minimum: 0, maximum: 360 },
            timestamp: { type: 'number' }
          },
          required: ['latitude', 'longitude', 'timestamp']
        }
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

  // Import templates from file
  async importTemplates(file) {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      // Validate import format
      if (!importData.templates || !Array.isArray(importData.templates)) {
        throw new Error('Invalid template file format. Expected { templates: [...] }');
      }

      const imported = [];
      const errors = [];

      for (const template of importData.templates) {
        try {
          // Validate required fields
          if (!template.id || !template.name || !template.topic || template.payload === undefined) {
            errors.push(`Template "${template.name || 'Unknown'}" missing required fields`);
            continue;
          }

          // Generate unique ID if conflicts exist
          let templateId = template.id;
          let counter = 1;
          while (this.templates[templateId]) {
            templateId = `${template.id}_${counter}`;
            counter++;
          }

          const templateToSave = {
            ...template,
            id: templateId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            imported: true
          };

          this.templates[templateId] = templateToSave;
          imported.push(templateToSave);
        } catch (error) {
          errors.push(`Failed to import template "${template.name}": ${error.message}`);
        }
      }

      if (imported.length > 0) {
        this.saveTemplates();
      }

      return {
        imported: imported.length,
        errors,
        templates: imported
      };
    } catch (error) {
      throw new Error(`Failed to import templates: ${error.message}`);
    }
  }

  // Export templates to file
  exportTemplates(templateIds = null) {
    const templatesToExport = templateIds 
      ? templateIds.map(id => this.templates[id]).filter(Boolean)
      : Object.values(this.templates);

    return {
      exportDate: new Date().toISOString(),
      version: '1.0',
      templates: templatesToExport.map(template => ({
        ...template,
        // Remove runtime fields for cleaner export
        createdAt: undefined,
        updatedAt: undefined,
        imported: undefined
      }))
    };
  }

  // Validate payload against schema
  validatePayload(templateId, payload) {
    const template = this.templates[templateId];
    if (!template || !template.schema) {
      return { valid: true, errors: [] };
    }

    try {
      const parsedPayload = JSON.parse(payload);
      return this.validateAgainstSchema(parsedPayload, template.schema);
    } catch (error) {
      return {
        valid: false,
        errors: ['Invalid JSON format']
      };
    }
  }

  // Simple JSON Schema validation
  validateAgainstSchema(data, schema) {
    const errors = [];

    if (schema.type === 'object' && typeof data !== 'object') {
      errors.push('Expected object type');
      return { valid: false, errors };
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (schema.required && schema.required.includes(key) && !(key in data)) {
          errors.push(`Missing required property: ${key}`);
          continue;
        }

        if (key in data) {
          const value = data[key];
          const propErrors = this.validateProperty(key, value, propSchema);
          errors.push(...propErrors);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  validateProperty(key, value, schema) {
    const errors = [];

    // Type validation
    if (schema.type) {
      const expectedType = schema.type;
      const actualType = schema.type === 'integer' ? 'number' : typeof value;
      
      if (expectedType === 'integer' && (!Number.isInteger(value))) {
        errors.push(`${key}: Expected integer, got ${typeof value}`);
      } else if (expectedType !== 'integer' && actualType !== expectedType) {
        errors.push(`${key}: Expected ${expectedType}, got ${actualType}`);
      }
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${key}: Value must be one of: ${schema.enum.join(', ')}`);
    }

    // Number/integer constraints
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${key}: Value ${value} is below minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${key}: Value ${value} is above maximum ${schema.maximum}`);
      }
    }

    // String constraints
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${key}: String length ${value.length} is below minimum ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${key}: String length ${value.length} is above maximum ${schema.maxLength}`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${key}: String does not match required pattern`);
      }
    }

    return errors;
  }

  // Generate sample payload from schema
  generateSampleFromSchema(schema) {
    if (!schema || schema.type !== 'object' || !schema.properties) {
      return '{}';
    }

    const sample = {};
    
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      sample[key] = this.generateSampleValue(propSchema);
    }

    return JSON.stringify(sample, null, 2);
  }

  generateSampleValue(schema) {
    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum[0];
        if (schema.pattern === '^\\d+\\.\\d+\\.\\d+$') return '1.0.0';
        return 'sample_string';
      
      case 'number':
        if (schema.minimum !== undefined && schema.maximum !== undefined) {
          return Math.round((schema.minimum + schema.maximum) / 2 * 100) / 100;
        }
        return 42.5;
      
      case 'integer':
        if (schema.minimum !== undefined && schema.maximum !== undefined) {
          return Math.round((schema.minimum + schema.maximum) / 2);
        }
        return 42;
      
      case 'boolean':
        return true;
      
      case 'array':
        return [];
      
      case 'object':
        return {};
      
      default:
        return null;
    }
  }
}

export default MessageTemplateService;