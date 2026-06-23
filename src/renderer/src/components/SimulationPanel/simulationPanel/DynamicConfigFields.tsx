import { useState } from 'react';

interface Props {
  dataType: string;
  generator: string;
  config: any;
  onConfigChange: (field: string, value: any) => void;
}

function DynamicConfigFields({ dataType, generator, config, onConfigChange }: Props) {
  const [booleanValueDropdownOpen, setBooleanValueDropdownOpen] = useState(false);
  const [patternValueDropdowns, setPatternValueDropdowns] = useState<Record<number, boolean>>({});

  const togglePatternDropdown = (index: number) => {
    setPatternValueDropdowns(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };
  const renderNumberFields = () => {
    switch (generator) {
      case 'static':
        return (
          <div className="form-group">
            <label>Value:</label>
            <input 
              type="number"
              step="0.01"
              value={config.value || 0}
              onChange={(e) => onConfigChange('value', parseFloat(e.target.value) || 0)}
              className="form-input"
            />
          </div>
        );
      
      case 'uniform':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      case 'normal':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Mean:</label>
              <input 
                type="number"
                step="0.01"
                value={config.mean || 0}
                onChange={(e) => onConfigChange('mean', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Std Dev:</label>
              <input 
                type="number"
                step="0.01"
                value={config.stdDev || 1}
                onChange={(e) => onConfigChange('stdDev', parseFloat(e.target.value) || 1)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      case 'sine':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Frequency (Hz):</label>
              <input 
                type="number"
                step="0.001"
                value={config.frequency || 0.1}
                onChange={(e) => onConfigChange('frequency', parseFloat(e.target.value) || 0.1)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      case 'exponential':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Lambda:</label>
              <input 
                type="number"
                step="0.01"
                value={config.lambda || 1}
                onChange={(e) => onConfigChange('lambda', parseFloat(e.target.value) || 1)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  const renderBooleanFields = () => {
    switch (generator) {
      case 'static':
        return (
          <div className="form-group">
            <label>Value:</label>
            <div className="custom-select-wrapper">
              <button 
                type="button" 
                className="custom-select-button"
                onClick={() => setBooleanValueDropdownOpen(!booleanValueDropdownOpen)}
              >
                <span className="select-value">
                  {config.value ? 'True' : 'False'}
                </span>
                <i className={`fas fa-chevron-down ${booleanValueDropdownOpen ? 'rotated' : ''}`}></i>
              </button>
              {booleanValueDropdownOpen && (
                <div className="custom-select-dropdown">
                  <button 
                    type="button"
                    className={`dropdown-option ${config.value === true ? 'selected' : ''}`}
                    onClick={() => {
                      onConfigChange('value', true);
                      setBooleanValueDropdownOpen(false);
                    }}
                  >
                    True
                  </button>
                  <button 
                    type="button"
                    className={`dropdown-option ${config.value === false ? 'selected' : ''}`}
                    onClick={() => {
                      onConfigChange('value', false);
                      setBooleanValueDropdownOpen(false);
                    }}
                  >
                    False
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      
      case 'probability':
        return (
          <div className="form-group">
            <label>True Probability (0-1):</label>
            <input 
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={config.trueProbability || 0.5}
              onChange={(e) => onConfigChange('trueProbability', parseFloat(e.target.value) || 0.5)}
              className="form-input"
            />
          </div>
        );
      
      case 'pattern':
        return (
          <div className="form-group">
            <label>Pattern Sequence:</label>
            <div className="pattern-editor">
              {(config.sequence || []).map((value: any, index: number) => (
                <div key={index} className="pattern-item">
                  <div className="custom-select-wrapper">
                    <button 
                      type="button" 
                      className="custom-select-button"
                      onClick={() => togglePatternDropdown(index)}
                    >
                      <span className="select-value">
                        {value ? 'True' : 'False'}
                      </span>
                      <i className={`fas fa-chevron-down ${patternValueDropdowns[index] ? 'rotated' : ''}`}></i>
                    </button>
                    {patternValueDropdowns[index] && (
                      <div className="custom-select-dropdown">
                        <button 
                          type="button"
                          className={`dropdown-option ${value === true ? 'selected' : ''}`}
                          onClick={() => {
                            const newSequence = [...(config.sequence || [])];
                            newSequence[index] = true;
                            onConfigChange('sequence', newSequence);
                            togglePatternDropdown(index);
                          }}
                        >
                          True
                        </button>
                        <button 
                          type="button"
                          className={`dropdown-option ${value === false ? 'selected' : ''}`}
                          onClick={() => {
                            const newSequence = [...(config.sequence || [])];
                            newSequence[index] = false;
                            onConfigChange('sequence', newSequence);
                            togglePatternDropdown(index);
                          }}
                        >
                          False
                        </button>
                      </div>
                    )}
                  </div>
                  <button 
                    type="button"
                    onClick={() => {
                      const newSequence = [...(config.sequence || [])];
                      newSequence.splice(index, 1);
                      onConfigChange('sequence', newSequence);
                    }}
                    className="btn btn-sm btn-danger"
                    style={{ borderRadius: 'var(--radius-pill)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => {
                  const newSequence = [...(config.sequence || []), true];
                  onConfigChange('sequence', newSequence);
                }}
                className="btn btn-sm btn-success"
                style={{ borderRadius: 'var(--radius-pill)' }}
              >
                Add Step
              </button>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  const renderStringFields = () => {
    switch (generator) {
      case 'static':
        return (
          <div className="form-group">
            <label>Value:</label>
            <input 
              type="text"
              value={config.value || ''}
              onChange={(e) => onConfigChange('value', e.target.value)}
              className="form-input"
            />
          </div>
        );
      
      case 'list':
      case 'random':
        return (
          <div className="form-group">
            <label>Values:</label>
            <div className="string-list-editor">
              {(config.values || []).map((value: any, index: number) => (
                <div key={index} className="string-list-item">
                  <input 
                    type="text"
                    value={value}
                    onChange={(e) => {
                      const newValues = [...(config.values || [])];
                      newValues[index] = e.target.value;
                      onConfigChange('values', newValues);
                    }}
                    className="form-input"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      const newValues = [...(config.values || [])];
                      newValues.splice(index, 1);
                      onConfigChange('values', newValues);
                    }}
                    className="btn btn-sm btn-danger"
                    style={{ borderRadius: 'var(--radius-pill)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => {
                  const newValues = [...(config.values || []), ''];
                  onConfigChange('values', newValues);
                }}
                className="btn btn-sm btn-success"
                style={{ borderRadius: 'var(--radius-pill)' }}
              >
                Add Value
              </button>
            </div>
          </div>
        );
      
      case 'weighted':
        return (
          <div className="form-group">
            <label>Weighted Values:</label>
            <div className="weighted-list-editor">
              {(config.weightedValues || []).map((item: any, index: number) => (
                <div key={index} className="weighted-list-item">
                  <input 
                    type="text"
                    placeholder="Value"
                    value={item.value}
                    onChange={(e) => {
                      const newValues = [...(config.weightedValues || [])];
                      newValues[index] = { ...newValues[index], value: e.target.value };
                      onConfigChange('weightedValues', newValues);
                    }}
                    className="form-input"
                  />
                  <input 
                    type="number"
                    placeholder="Weight"
                    min="0"
                    step="0.1"
                    value={item.weight}
                    onChange={(e) => {
                      const newValues = [...(config.weightedValues || [])];
                      newValues[index] = { ...newValues[index], weight: parseFloat(e.target.value) || 1 };
                      onConfigChange('weightedValues', newValues);
                    }}
                    className="form-input"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      const newValues = [...(config.weightedValues || [])];
                      newValues.splice(index, 1);
                      onConfigChange('weightedValues', newValues);
                    }}
                    className="btn btn-sm btn-danger"
                    style={{ borderRadius: 'var(--radius-pill)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => {
                  const newValues = [...(config.weightedValues || []), { value: '', weight: 1 }];
                  onConfigChange('weightedValues', newValues);
                }}
                className="btn btn-sm btn-success"
                style={{ borderRadius: 'var(--radius-pill)' }}
              >
                Add Weighted Value
              </button>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  switch (dataType) {
    case 'number':
      return renderNumberFields();
    case 'boolean':
      return renderBooleanFields();
    case 'string':
    case 'enum':
      return renderStringFields();
    default:
      return null;
  }
}

export default DynamicConfigFields;
