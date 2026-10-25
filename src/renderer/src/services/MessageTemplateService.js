import { validateJson } from '../../../shared/json-schema';
import { templateFromSchema } from '../../../shared/schema-template';
import { expandTemplate } from '../../../shared/template-expansion';

class MessageTemplateService {
  constructor() {
    this.templates = this.loadTemplates();
  }

  loadTemplates() {
    try {
      const saved = localStorage.getItem('mqtt-message-templates');
      const defaults = this.getDefaultTemplates();
      if (!saved) return defaults;
      const templates = JSON.parse(saved);
      for (const [id, stock] of Object.entries(defaults)) {
        const template = templates[id];
        if (
          template &&
          !template.variables &&
          template.topic === stock.topic &&
          template.payload === stock.payload
        )
          template.variables = stock.variables;
      }
      return templates;
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
        payload: JSON.stringify(
          {
            temperature: '{{randomFloat(15, 35, 1)}}',
            humidity: '{{randomFloat(30, 80, 1)}}',
            timestamp: '{{timestamp}}',
            sensorId: '{{sensorId}}',
          },
          null,
          2,
        ),
        qos: 0,
        retain: false,
        category: 'IoT Sensors',
        variables: {
          sensorId: { type: 'text', default: 'temp-001', description: 'Sensor identifier' },
        },
        schema: {
          type: 'object',
          properties: {
            temperature: { type: 'number', minimum: -50, maximum: 100 },
            humidity: { type: 'number', minimum: 0, maximum: 100 },
            timestamp: { type: 'number' },
            sensorId: { type: 'string', minLength: 1 },
          },
          required: ['temperature', 'humidity', 'timestamp', 'sensorId'],
        },
      },
      'device-status': {
        id: 'device-status',
        name: 'Device Status',
        topic: 'devices/{{deviceId}}/status',
        payload: JSON.stringify(
          {
            status: '{{randomChoice("online", "offline", "maintenance")}}',
            lastSeen: '{{timestamp}}',
            batteryLevel: '{{randomInt(0, 100)}}',
            firmwareVersion: '1.2.3',
          },
          null,
          2,
        ),
        qos: 1,
        retain: true,
        category: 'Device Management',
        variables: {
          deviceId: { type: 'text', default: 'device-001' },
        },
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['online', 'offline', 'maintenance'] },
            lastSeen: { type: 'number' },
            batteryLevel: { type: 'integer', minimum: 0, maximum: 100 },
            firmwareVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
          },
          required: ['status', 'lastSeen'],
        },
      },
      'gps-location': {
        id: 'gps-location',
        name: 'GPS Location',
        topic: 'tracking/{{vehicleId}}/location',
        payload: JSON.stringify(
          {
            latitude: '{{randomFloat(-90, 90, 6)}}',
            longitude: '{{randomFloat(-180, 180, 6)}}',
            speed: '{{randomFloat(0, 120, 1)}}',
            heading: '{{randomInt(0, 360)}}',
            timestamp: '{{timestamp}}',
          },
          null,
          2,
        ),
        qos: 0,
        retain: false,
        category: 'Location Services',
        variables: {
          vehicleId: { type: 'text', default: 'vehicle-001' },
        },
        schema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', minimum: -90, maximum: 90 },
            longitude: { type: 'number', minimum: -180, maximum: 180 },
            speed: { type: 'number', minimum: 0 },
            heading: { type: 'integer', minimum: 0, maximum: 360 },
            timestamp: { type: 'number' },
          },
          required: ['latitude', 'longitude', 'timestamp'],
        },
      },
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
      updatedAt: Date.now(),
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

  processTemplate(template, variables = {}) {
    return {
      ...expandTemplate(template, variables),
      qos: template.qos,
      retain: template.retain,
      properties: template.properties,
    };
  }

  getCategories() {
    const categories = new Set();
    Object.values(this.templates).forEach((template) => {
      if (template.category) {
        categories.add(template.category);
      }
    });
    return Array.from(categories).sort();
  }

  // Create a template from a standalone JSON Schema
  createTemplateFromSchema(schema) {
    // Extract metadata from schema
    const title = schema.title || 'Imported Schema';
    const id = this.generateIdFromTitle(title);

    // Generate a flexible default topic - can be easily changed by user
    const topic = `${id}`;

    // Placeholders generate fresh values that satisfy the schema on each Apply.
    const payload = templateFromSchema(schema);

    return {
      id: id,
      name: title,
      topic: topic,
      payload: payload,
      qos: 0,
      retain: false,
      category: 'Imported Schemas',
      schema: schema,
      description: schema.description || `Template created from imported ${title} schema`,
    };
  }

  // Generate a valid ID from a title
  generateIdFromTitle(title) {
    return (
      title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .substring(0, 50) || // Limit length
      'imported-schema'
    ); // Fallback
  }

  // Helper function to validate if a schema structure is valid
  isValidSchema(schema) {
    try {
      if (!schema || typeof schema !== 'object') {
        return false;
      }

      // Accept any object-type schema (including JSON Schema with metadata)
      if (schema.type === 'object' || schema.$schema || schema.$id || schema.title) {
        return true;
      }

      // Accept simple schemas with properties
      if (schema.properties && typeof schema.properties === 'object') {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // Import templates from file
  async importTemplates(file) {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      console.log('Import data received:', {
        hasSchema: !!importData.$schema,
        hasId: !!importData.$id,
        hasTitle: !!importData.title,
        hasType: !!importData.type,
        hasProperties: !!importData.properties,
        hasTemplates: !!importData.templates,
      });

      const imported = [];
      const errors = [];

      // Check if this is a standalone schema or a template collection
      if (
        importData.$schema ||
        importData.$id ||
        importData.title ||
        (importData.type && importData.properties)
      ) {
        // This is a standalone JSON Schema - create a template from it
        console.log('Detected standalone schema:', importData.title || 'Untitled');
        try {
          const template = this.createTemplateFromSchema(importData);

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
            imported: true,
          };

          this.templates[templateId] = templateToSave;
          imported.push(templateToSave);
        } catch (error) {
          console.error('Schema processing error:', error);
          errors.push(`Failed to create template from schema: ${error.message}`);
        }
      } else if (importData.templates && Array.isArray(importData.templates)) {
        // This is a template collection file
        for (const template of importData.templates) {
          try {
            // Validate required fields
            if (
              !template.id ||
              !template.name ||
              !template.topic ||
              template.payload === undefined
            ) {
              errors.push(`Template "${template.name || 'Unknown'}" missing required fields`);
              continue;
            }

            // Validate schema if present
            if (template.schema && !this.isValidSchema(template.schema)) {
              console.warn(
                `Template "${template.name}" has invalid schema, but will still be imported`,
              );
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
              imported: true,
            };

            this.templates[templateId] = templateToSave;
            imported.push(templateToSave);
          } catch (error) {
            errors.push(`Failed to import template "${template.name}": ${error.message}`);
          }
        }
      } else {
        console.log('File format not recognized. Data structure:', Object.keys(importData));
        throw new Error(
          'Invalid file format. Expected either a JSON Schema or a template collection with { templates: [...] }',
        );
      }

      if (imported.length > 0) {
        this.saveTemplates();
      }

      return {
        imported: imported.length,
        errors,
        templates: imported,
      };
    } catch (error) {
      console.error('Import error:', error.message);
      throw new Error(`Failed to import templates: ${error.message}`);
    }
  }

  // Export templates to file
  exportTemplates(templateIds = null) {
    const templatesToExport = templateIds
      ? templateIds.map((id) => this.templates[id]).filter(Boolean)
      : Object.values(this.templates);

    return {
      exportDate: new Date().toISOString(),
      version: '1.0',
      templates: templatesToExport.map((template) => ({
        ...template,
        // Remove runtime fields for cleaner export
        createdAt: undefined,
        updatedAt: undefined,
        imported: undefined,
      })),
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
    } catch {
      return {
        valid: false,
        errors: ['Invalid JSON format'],
      };
    }
  }

  // Standards-based JSON Schema validation for the dialect the schema declares.
  validateAgainstSchema(data, schema) {
    return validateJson(data, schema);
  }
}

export default MessageTemplateService;
