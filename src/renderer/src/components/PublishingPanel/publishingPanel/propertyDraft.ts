import {
  normalizePublishProperties,
  type PublishProperties,
} from '../../../../../shared/publish-properties';

export interface PropertyDraft {
  enabled: boolean;
  responseTopic: string;
  contentType: string;
  expiry: string;
  format: '' | 'bytes' | 'utf8';
  correlationEnabled: boolean;
  correlationEncoding: 'hex' | 'base64';
  correlation: string;
  users: { name: string; value: string }[];
}
export const emptyPropertyDraft = (): PropertyDraft => ({
  enabled: false,
  responseTopic: '',
  contentType: '',
  expiry: '',
  format: '',
  correlationEnabled: false,
  correlationEncoding: 'hex',
  correlation: '',
  users: [],
});

export function readPropertyDraft(value: unknown): PropertyDraft {
  const draft = emptyPropertyDraft();
  if (!value || typeof value !== 'object') return draft;
  const saved = value as Record<string, unknown>;
  for (const key of ['responseTopic', 'contentType', 'expiry', 'correlation'] as const)
    if (typeof saved[key] === 'string') draft[key] = saved[key];
  draft.enabled = saved.enabled === true;
  draft.correlationEnabled = saved.correlationEnabled === true;
  if (saved.format === 'bytes' || saved.format === 'utf8') draft.format = saved.format;
  if (saved.correlationEncoding === 'base64') draft.correlationEncoding = 'base64';
  if (Array.isArray(saved.users))
    draft.users = saved.users.filter(
      (row) => row && typeof row.name === 'string' && typeof row.value === 'string',
    );
  return draft;
}

export function buildPublishProperties(
  draft: PropertyDraft,
  protocol: number,
  payload: Uint8Array,
) {
  if (!draft.enabled) return undefined;
  if (protocol !== 5) throw new Error('Disable MQTT 5 properties or use an MQTT 5 connection.');
  const properties: PublishProperties = {};
  if (draft.responseTopic !== '') properties.responseTopic = draft.responseTopic;
  if (draft.contentType !== '') properties.contentType = draft.contentType;
  if (draft.expiry !== '') {
    if (!/^\d+$/.test(draft.expiry))
      throw new Error('Expiry must be a whole number of seconds, or blank.');
    properties.messageExpiryInterval = Number(draft.expiry);
  }
  if (draft.format !== '') properties.payloadFormatIndicator = draft.format === 'utf8';
  if (draft.correlationEnabled) {
    let data = draft.correlation;
    if (draft.correlationEncoding === 'hex') {
      const compact = data.replace(/\s/g, '');
      if (compact.length > 131070 || compact.length % 2 || /[^\da-f]/i.test(compact))
        throw new Error('Correlation hex must contain complete bytes, for example 00 ff 80.');
      let binary = '';
      for (let i = 0; i < compact.length; i += 2)
        binary += String.fromCharCode(parseInt(compact.slice(i, i + 2), 16));
      data = btoa(binary);
    }
    properties.correlationData = { encoding: 'base64', data };
  }
  if (draft.users.length) {
    if (draft.users.length > 64) throw new Error('At most 64 user property pairs are supported.');
    const users = new Map<string, string[]>();
    for (const row of draft.users) users.set(row.name, [...(users.get(row.name) ?? []), row.value]);
    properties.userProperties = Object.fromEntries(users);
  }
  return normalizePublishProperties(properties, protocol, payload);
}

export function draftFromProperties(properties?: PublishProperties): PropertyDraft {
  const draft = emptyPropertyDraft();
  if (!properties) return draft;
  const valid = normalizePublishProperties(properties, 5);
  if (!valid) return draft;
  draft.enabled = true;
  draft.responseTopic = valid.responseTopic ?? '';
  draft.contentType = valid.contentType ?? '';
  draft.expiry =
    valid.messageExpiryInterval === undefined ? '' : String(valid.messageExpiryInterval);
  draft.format =
    valid.payloadFormatIndicator === undefined
      ? ''
      : valid.payloadFormatIndicator
        ? 'utf8'
        : 'bytes';
  if (valid.correlationData) {
    draft.correlationEnabled = true;
    draft.correlationEncoding = 'base64';
    draft.correlation = valid.correlationData.data;
  }
  draft.users = Object.entries(valid.userProperties ?? {}).flatMap(([name, values]) =>
    (Array.isArray(values) ? values : [values]).map((value) => ({ name, value })),
  );
  return draft;
}
