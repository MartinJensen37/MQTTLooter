import type { PayloadEncoding } from '../../../shared/payload';

export function prettyPayload(
  value: string,
  encoding: PayloadEncoding,
): { text?: string; notice?: string } {
  if (encoding !== 'utf8') return { notice: 'JSON formatting requires a UTF-8 payload.' };
  if (value.length > 65536)
    return {
      notice:
        'JSON formatting is limited to 65,536 characters. Use Text or export the original payload.',
    };
  try {
    const parsed: unknown = JSON.parse(value);
    const pending = [{ value: parsed, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++nodes > 10000 || item.depth > 32)
        return {
          notice: 'JSON is too complex for this preview. Use Text or export the original payload.',
        };
      if (item.value && typeof item.value === 'object') {
        for (const child of Object.values(item.value))
          pending.push({ value: child, depth: item.depth + 1 });
      }
    }
    // Preserve number lexemes and duplicate keys; parsing/stringifying would round large integers.
    const tokens = value.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g)!;
    let text = '';
    let depth = 0;
    let clipped = false;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      let part = token;
      if (token === '{' || token === '[') {
        if (tokens[index + 1] !== (token === '{' ? '}' : ']')) {
          if (++depth > 32)
            return {
              notice:
                'JSON is too complex for this preview. Use Text or export the original payload.',
            };
          part += '\n' + '  '.repeat(depth);
        }
      } else if (token === '}' || token === ']') {
        if (tokens[index - 1] !== (token === '}' ? '{' : '['))
          part = '\n' + '  '.repeat(--depth) + token;
      } else if (token === ',') part += '\n' + '  '.repeat(depth);
      else if (token === ':') part += ' ';
      const available = 65536 - text.length;
      text += part.slice(0, available);
      if (part.length > available || (text.length === 65536 && index < tokens.length - 1)) {
        clipped = true;
        break;
      }
    }
    return {
      text,
      ...(clipped && {
        notice:
          'Formatted preview truncated at 65,536 characters. Export preserves the original payload.',
      }),
    };
  } catch {
    return { notice: 'This payload is not valid JSON. Use Text to inspect the original.' };
  }
}

export function plainLog(
  messages: {
    id: string;
    topic: string;
    message: string;
    timestamp: number;
    encoding?: PayloadEncoding;
  }[],
  maxChars = 262144,
) {
  const rows: { id: string; text: string }[] = [];
  let used = 0;
  let truncated = false;
  for (const message of messages) {
    const prefix = `${new Date(message.timestamp).toISOString()} ${JSON.stringify(message.topic)}${message.encoding === 'base64' ? ' [base64]' : ''} `;
    const available = Math.min(4096, maxChars - used - prefix.length - 64);
    if (available < 0) {
      truncated = true;
      break;
    }
    const clipped = message.message.length > available;
    const text =
      prefix +
      message.message.slice(0, available) +
      (clipped ? ' [preview truncated; export for full payload]' : '');
    rows.push({ id: message.id, text });
    used += text.length + 1;
    truncated ||= clipped;
  }
  return { rows, truncated };
}
