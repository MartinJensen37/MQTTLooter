import { useState } from 'react';

export default function HistoryControls({
  connectionId,
  selectedPath,
  statistics,
  settings,
  service,
  onSelect,
  onChange,
}) {
  const [error, setError] = useState('');
  const pins = statistics?.pinnedTopics ?? [];
  const pinned = pins.includes(selectedPath);
  const togglePin = (path) => {
    setError(
      service.toggleTopicPin(connectionId, path)
        ? ''
        : 'This topic cannot be pinned. The pin limit may have been reached.',
    );
    onChange();
  };
  return (
    <details className="topic-history-controls">
      <summary>History &amp; pins{pins.length ? ` (${pins.length})` : ''}</summary>
      <label>
        History cache
        <select
          className="custom-select-button form-select"
          aria-label="History cache"
          value={settings.profile}
          onChange={(event) => {
            setError(
              service.setHistoryProfile(event.target.value)
                ? ''
                : 'Unpin topics before reducing this cache budget.',
            );
            onChange();
          }}
        >
          <option value="compact">Compact: 32 MiB / 5,000 nodes</option>
          <option value="larger">Larger: 64 MiB / 20,000 nodes</option>
        </select>
      </label>
      <p>
        Per connection, including ancestors. Shared cache:{' '}
        {(settings.retainedBytes / 1048576).toFixed(1)} / {(settings.maxBytes / 1048576).toFixed(0)}{' '}
        MiB across all connections.
      </p>
      <p>
        Selected and pinned paths stay available. Old messages can expire. Changing the cache
        applies to all connections and may trim history immediately.
      </p>
      <button
        className="btn btn-sm btn-secondary"
        disabled={selectedPath == null || (!pinned && pins.length >= settings.maxPinnedTopics)}
        onClick={() => togglePin(selectedPath)}
        aria-pressed={pinned}
      >
        {pinned ? 'Unpin selected topic' : 'Pin selected topic'}
      </button>
      <span className="topic-pin-count">
        {pins.length} / {settings.maxPinnedTopics} pins
      </span>
      {pins.length > 0 && (
        <ul className="topic-pin-list">
          {pins.map((path) => (
            <li key={path}>
              <button
                className="btn btn-sm btn-ghost topic-pin-link"
                title={path}
                onClick={() => onSelect?.(path)}
              >
                {path || '(empty)'}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                aria-label={`Unpin ${path}`}
                onClick={() => togglePin(path)}
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
