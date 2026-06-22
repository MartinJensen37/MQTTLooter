export function generateClientId(): string {
  return `mqttlooter_${Math.random().toString(36).substr(2, 9)}`;
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export function formatTimestamp(timestamp: number | string | Date): string {
  return new Date(timestamp).toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getDefaultPort(protocol: string): number {
  const ports: Record<string, number> = {
    mqtt: 1883,
    mqtts: 8883,
    ws: 8080,
    wss: 8081,
  };
  return ports[protocol] || 1883;
}

export interface ParsedUrl {
  protocol: string;
  hostname: string;
  port: string | number;
  pathname: string;
}

export function parseUrl(url: string): ParsedUrl | null {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '');
    return {
      protocol,
      hostname: parsed.hostname,
      port: parsed.port || getDefaultPort(protocol),
      pathname: parsed.pathname,
    };
  } catch {
    return null;
  }
}
