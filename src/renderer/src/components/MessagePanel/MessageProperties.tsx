import { memo, useState } from 'react';
import { serializeProperties } from '../../../../shared/history';
import { correlationPreview, propertyRows } from '../../utils/mqttProperties';
import CheckToggle from '../Controls/CheckToggle';
import './MessageProperties.css';

function PropertyDetails({ properties }: { properties: Record<string, unknown> }) {
  const [feedback, setFeedback] = useState('');
  const { rows, truncated } = propertyRows(properties);
  const hasCorrelation = Object.hasOwn(properties, 'correlationData');
  const correlation = hasCorrelation ? correlationPreview(properties.correlationData) : undefined;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('Copied.');
    } catch {
      setFeedback('Could not copy to the clipboard.');
    }
  };
  return (
    <div className="message-properties-body">
      <dl>
        {rows.map((row, index) => (
          <div key={index}>
            <dt>{row.label}</dt>
            <dd>{row.value === '' ? '(empty)' : row.value}</dd>
          </div>
        ))}
      </dl>
      {hasCorrelation && (
        <div className="message-correlation">
          <strong>Correlation data (hex)</strong>
          {correlation ? (
            <>
              <pre tabIndex={0}>{correlation.hex || '(empty)'}</pre>
              <p>
                {correlation.length} bytes
                {correlation.length > 256
                  ? '; showing the first 256. Copy includes all bytes.'
                  : '.'}
              </p>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => void copy(correlation.base64)}
              >
                Copy correlation as base64
              </button>
            </>
          ) : (
            <p>
              Unrecognized correlation data. Copy properties to inspect the stored representation.
            </p>
          )}
        </div>
      )}
      {!rows.length && !hasCorrelation && <p>No publish properties were received.</p>}
      {truncated && <p>Preview shortened. Copy includes complete properties.</p>}
      <button
        className="btn btn-sm btn-secondary"
        onClick={() => void copy(serializeProperties(properties) ?? '{}')}
      >
        Copy properties as JSON
      </button>
      <span role="status">{feedback}</span>
    </div>
  );
}

function MessageProperties({
  protocolVersion,
  properties,
}: {
  protocolVersion?: number;
  properties?: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (protocolVersion !== 5 && !properties) return null;
  // Details mount only while shown; double-clicking them must not copy the card's payload.
  return (
    <div className="message-properties" onDoubleClick={(event) => event.stopPropagation()}>
      <CheckToggle
        compact
        label={protocolVersion === 5 ? 'MQTT 5 properties' : 'Message properties'}
        checked={expanded}
        onChange={setExpanded}
      >
        <PropertyDetails properties={properties ?? {}} />
      </CheckToggle>
    </div>
  );
}

export default memo(MessageProperties);
