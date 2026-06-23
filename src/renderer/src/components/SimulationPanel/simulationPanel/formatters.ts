import type { DeviceOutput } from './types';

/** Display string for an output's current value (quotes strings, appends units). */
export function formatOutputValue(output: DeviceOutput): string {
  const value = output.currentValue;
  switch (output.dataType) {
    case 'string':
    case 'enum':
      return `"${value}"`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return `${value}${output.unit || ''}`;
    default:
      return String(value);
  }
}

/** Pretty-print a preview payload, or 'N/A' when empty. */
export function formatPreviewValue(previewValue: any): string {
  if (!previewValue) return 'N/A';
  return JSON.stringify(previewValue, null, 2);
}
