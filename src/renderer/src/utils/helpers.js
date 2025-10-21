export function generateClientId() {
  return `mqttlooter_${Math.random().toString(36).substr(2, 9)}`;
}

export function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getDefaultPort(protocol) {
  const ports = {
    'mqtt': 1883,
    'mqtts': 8883,
    'ws': 8080,
    'wss': 8081
  };
  return ports[protocol] || 1883;
}

export function parseUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol.replace(':', ''),
      hostname: parsed.hostname,
      port: parsed.port || getDefaultPort(parsed.protocol.replace(':', '')),
      pathname: parsed.pathname
    };
  } catch (error) {
    return null;
  }
}