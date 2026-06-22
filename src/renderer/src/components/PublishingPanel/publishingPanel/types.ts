// Shared types for the PublishingPanel and its section components.

export interface PublishHistoryItem {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  timestamp: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

// Templates come from the (untyped) MessageTemplateService; shape kept loose.
export type MessageTemplate = any;
