import { validateJson } from '../../../shared/json-schema';
import { templateFromSchema } from '../../../shared/schema-template';
import { expandTemplate } from '../../../shared/template-expansion';

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const VERSION_KEY = 'mqtt-message-templates-version';
const VERSION = 2;

/**
 * Example message schemas. Each is a JSON Schema plus a topic; the payload is generated from
 * the schema, so every Fill payload produces a message that matches it. Properties named like
 * a variable take that variable's value.
 */
const EXAMPLES = [
  {
    id: 'sensor-reading',
    name: 'Sensor reading',
    description: 'A climate sensor reporting temperature and humidity.',
    topic: 'sensors/{{sensorId}}/reading',
    qos: 0,
    retain: false,
    variables: {
      sensorId: { type: 'text', default: 'sensor-01', description: 'Sensor name' },
    },
    schema: {
      $schema: SCHEMA,
      title: 'Sensor reading',
      type: 'object',
      required: ['sensorId', 'temperature', 'humidity', 'time'],
      additionalProperties: false,
      properties: {
        sensorId: { type: 'string', minLength: 1 },
        temperature: { type: 'number', minimum: -40, maximum: 85, description: 'Degrees Celsius' },
        humidity: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Relative humidity in %',
        },
        time: { type: 'string', format: 'date-time' },
      },
    },
  },
  {
    id: 'device-status',
    name: 'Device status',
    description: 'A retained status message for a connected device.',
    topic: 'devices/{{deviceId}}/status',
    qos: 1,
    retain: true,
    variables: {
      deviceId: { type: 'text', default: 'device-01', description: 'Device name' },
    },
    schema: {
      $schema: SCHEMA,
      title: 'Device status',
      type: 'object',
      required: ['deviceId', 'state', 'battery', 'firmware'],
      additionalProperties: false,
      properties: {
        deviceId: { type: 'string', minLength: 1 },
        state: { enum: ['online', 'offline', 'maintenance'] },
        battery: { type: 'integer', minimum: 0, maximum: 100, description: 'Charge in %' },
        firmware: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', examples: ['1.4.2'] },
      },
    },
  },
];

/** Topic and payload of the examples shipped before message schemas, to replace them unchanged. */
const LEGACY_EXAMPLES = {
  'temperature-sensor': {
    topic: 'sensors/temperature/{{sensorId}}',
    payload: {
      temperature: '{{randomFloat(15, 35, 1)}}',
      humidity: '{{randomFloat(30, 80, 1)}}',
      timestamp: '{{timestamp}}',
      sensorId: '{{sensorId}}',
    },
  },
  'device-status': {
    topic: 'devices/{{deviceId}}/status',
    payload: {
      status: '{{randomChoice("online", "offline", "maintenance")}}',
      lastSeen: '{{timestamp}}',
      batteryLevel: '{{randomInt(0, 100)}}',
      firmwareVersion: '1.2.3',
    },
  },
  'gps-location': {
    topic: 'tracking/{{vehicleId}}/location',
    payload: {
      latitude: '{{randomFloat(-90, 90, 6)}}',
      longitude: '{{randomFloat(-180, 180, 6)}}',
      speed: '{{randomFloat(0, 120, 1)}}',
      heading: '{{randomInt(0, 360)}}',
      timestamp: '{{timestamp}}',
    },
  },
};

/** Message schemas for Publishing: a JSON Schema, a topic and a payload template generated from it. */
class MessageTemplateService {
  constructor() {
    this.templates = this.loadTemplates();
  }

  loadTemplates() {
    try {
      const saved = localStorage.getItem('mqtt-message-templates');
      if (!saved) return this.getDefaultTemplates();
      const templates = JSON.parse(saved);
      if (Number(localStorage.getItem(VERSION_KEY)) < VERSION) {
        this.templates = this.migrate(templates);
        this.saveTemplates();
        localStorage.setItem(VERSION_KEY, String(VERSION));
        return this.templates;
      }
      return templates;
    } catch (error) {
      console.error('Failed to load message schemas:', error);
      return this.getDefaultTemplates();
    }
  }

  /** Replace unchanged old examples with the current ones; edited and custom entries stay. */
  migrate(templates) {
    const result = { ...templates };
    for (const [id, legacy] of Object.entries(LEGACY_EXAMPLES)) {
      const saved = result[id];
      if (
        saved &&
        saved.topic === legacy.topic &&
        saved.payload === JSON.stringify(legacy.payload, null, 2)
      )
        delete result[id];
    }
    for (const [id, example] of Object.entries(this.getDefaultTemplates()))
      if (!result[id]) result[id] = example;
    return result;
  }

  saveTemplates() {
    localStorage.setItem('mqtt-message-templates', JSON.stringify(this.templates));
    localStorage.setItem(VERSION_KEY, String(VERSION));
  }

  getDefaultTemplates() {
    return Object.fromEntries(
      EXAMPLES.map((example) => [
        example.id,
        {
          ...example,
          category: 'Examples',
          payload: templateFromSchema(example.schema, {
            variables: Object.keys(example.variables),
          }),
        },
      ]),
    );
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
      category: 'Imported',
      schema: schema,
      description: schema.description || `Imported from the ${title} schema`,
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
        throw new Error('Choose a JSON Schema, or a file exported from Message schemas.');
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
      throw new Error(error.message);
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
