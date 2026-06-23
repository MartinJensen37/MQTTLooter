import React, { useState, useEffect } from 'react';
import { DATA_TYPE_CONFIGS, GENERATOR_CONFIGS } from './constants';
import { formatPreviewValue } from './formatters';
import DynamicConfigFields from './DynamicConfigFields';

interface Props {
  output: any;
  onClose: () => void;
  onSave: (formData: any) => void;
}

function EditOutputModal({ output, onClose, onSave }: Props) {
  const [formData, setFormData] = useState({
    name: output.name,
    dataType: output.dataType,
    generator: output.generator,
    unit: output.unit || '',
    decimalPrecision: output.decimalPrecision || 2,
    includeTimestamp: output.includeTimestamp !== false,
    config: { ...output.config }
  });

  const [previewValue, setPreviewValue] = useState<any>(null);
  const [dataTypeDropdownOpen, setDataTypeDropdownOpen] = useState(false);
  const [generatorDropdownOpen, setGeneratorDropdownOpen] = useState(false);
  const [decimalDropdownOpen, setDecimalDropdownOpen] = useState(false);

  // Update preview when form data changes
  useEffect(() => {
    const generatePreview = () => {
      try {
        let value;
        
        switch (formData.dataType) {
          case 'number':
            value = generateNumberPreview(formData.generator, formData.config, formData.decimalPrecision);
            break;
          case 'boolean':
            value = generateBooleanPreview(formData.generator, formData.config);
            break;
          case 'string':
          case 'enum':
            value = generateStringPreview(formData.generator, formData.config);
            break;
          default:
            value = 'N/A';
        }

        const outputPayload: any = {
          value: value
        };

        if (formData.dataType === 'number' && formData.unit && formData.unit.trim()) {
          outputPayload.unit = formData.unit.trim();
        }

        if (formData.includeTimestamp) {
          outputPayload.timestamp = new Date().toISOString();
        }

        setPreviewValue(outputPayload);
      } catch (error) {
        setPreviewValue({ error: 'Preview generation failed' });
      }
    };

    generatePreview();
    const interval = setInterval(generatePreview, 2000);
    return () => clearInterval(interval);
  }, [formData]);

  const generateNumberPreview = (generator: string, config: any, precision: number) => {
    switch (generator) {
      case 'static':
        return Number((config.value || 0).toFixed(precision));
      case 'uniform': {
        const mid = ((config.max || 100) + (config.min || 0)) / 2;
        return Number(mid.toFixed(precision));
      }
      case 'normal':
        return Number((config.mean || 0).toFixed(precision));
      case 'sine':
        return Number(((config.max || 100) + (config.min || 0)) / 2).toFixed(precision);
      case 'exponential':
        return Number(((config.min || 0) + 5).toFixed(precision));
      default:
        return 0;
    }
  };

  const generateBooleanPreview = (generator: string, config: any) => {
    switch (generator) {
      case 'static':
        return Boolean(config.value);
      case 'probability':
        return (config.trueProbability || 0.5) > 0.5;
      case 'pattern':
        return config.sequence && config.sequence.length > 0 ? config.sequence[0] : true;
      default:
        return true;
    }
  };

  const generateStringPreview = (generator: string, config: any) => {
    switch (generator) {
      case 'static':
        return config.value || 'default';
      case 'list':
      case 'random':
        return config.values && config.values.length > 0 ? config.values[0] : 'default';
      case 'weighted':
        return config.weightedValues && config.weightedValues.length > 0 ? config.weightedValues[0].value : 'default';
      default:
        return 'default';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateConfig = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      config: { ...prev.config, [field]: value }
    }));
  };

  const handleDataTypeChange = (newDataType: string) => {
    const availableGenerators = DATA_TYPE_CONFIGS[newDataType].generators;
    const defaultGenerator = availableGenerators[0];
    
    let defaultConfig = {};
    
    switch (newDataType) {
      case 'number':
        if (defaultGenerator === 'normal') {
          defaultConfig = { mean: 50, stdDev: 10, min: 0, max: 100 };
        } else if (defaultGenerator === 'uniform') {
          defaultConfig = { min: 0, max: 100 };
        } else if (defaultGenerator === 'static') {
          defaultConfig = { value: 50 };
        }
        break;
      case 'boolean':
        if (defaultGenerator === 'probability') {
          defaultConfig = { trueProbability: 0.5 };
        } else if (defaultGenerator === 'static') {
          defaultConfig = { value: true };
        }
        break;
      case 'string':
      case 'enum':
        if (defaultGenerator === 'list') {
          defaultConfig = { values: ['option1', 'option2'] };
        } else if (defaultGenerator === 'static') {
          defaultConfig = { value: 'default' };
        }
        break;
    }

    setFormData(prev => ({
      ...prev,
      dataType: newDataType,
      generator: defaultGenerator,
      config: defaultConfig,
      unit: DATA_TYPE_CONFIGS[newDataType].hasUnit ? prev.unit : '',
      decimalPrecision: DATA_TYPE_CONFIGS[newDataType].hasDecimalPrecision ? prev.decimalPrecision : undefined
    }));
  };

  const handleGeneratorChange = (newGenerator: string) => {
    let defaultConfig = {};
    
    switch (formData.dataType) {
      case 'number':
        switch (newGenerator) {
          case 'static':
            defaultConfig = { value: 50 };
            break;
          case 'uniform':
            defaultConfig = { min: 0, max: 100 };
            break;
          case 'normal':
            defaultConfig = { mean: 50, stdDev: 10, min: 0, max: 100 };
            break;
          case 'sine':
            defaultConfig = { min: 0, max: 100, frequency: 0.1 };
            break;
          case 'exponential':
            defaultConfig = { lambda: 1, min: 0, max: 100 };
            break;
        }
        break;
      case 'boolean':
        switch (newGenerator) {
          case 'static':
            defaultConfig = { value: true };
            break;
          case 'probability':
            defaultConfig = { trueProbability: 0.5 };
            break;
          case 'pattern':
            defaultConfig = { sequence: [true, false], intervalMs: 5000 };
            break;
        }
        break;
      case 'string':
      case 'enum':
        switch (newGenerator) {
          case 'static':
            defaultConfig = { value: 'default' };
            break;
          case 'list':
          case 'random':
            defaultConfig = { values: ['option1', 'option2'] };
            break;
          case 'weighted':
            defaultConfig = { weightedValues: [{ value: 'option1', weight: 1 }, { value: 'option2', weight: 1 }] };
            break;
        }
        break;
    }

    setFormData(prev => ({
      ...prev,
      generator: newGenerator,
      config: defaultConfig
    }));
  };

  const availableGenerators = DATA_TYPE_CONFIGS[formData.dataType]?.generators || [];

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>Edit Output: {output.name}</h3>
          <button 
            onClick={onClose} 
            className="modal-close-btn"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="panel-content output-form">
          {/* Base Fields */}
          <div className="form-row">
            <div className="form-group">
              <label>Name:</label>
              <input 
                type="text"
                value={formData.name}
                onChange={(e) => updateFormData('name', e.target.value)}
                className="form-input"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Data Type:</label>
              <div className="custom-select-wrapper">
                <button 
                  type="button" 
                  className="custom-select-button"
                  onClick={() => setDataTypeDropdownOpen(!dataTypeDropdownOpen)}
                >
                  <span className="select-value">
                    {DATA_TYPE_CONFIGS[formData.dataType]?.label || formData.dataType}
                  </span>
                  <i className={`fas fa-chevron-down ${dataTypeDropdownOpen ? 'rotated' : ''}`}></i>
                </button>
                {dataTypeDropdownOpen && (
                  <div className="custom-select-dropdown">
                    {Object.entries(DATA_TYPE_CONFIGS).map(([key, config]) => (
                      <button 
                        key={key}
                        type="button"
                        className={`dropdown-option ${formData.dataType === key ? 'selected' : ''}`}
                        onClick={() => {
                          handleDataTypeChange(key);
                          setDataTypeDropdownOpen(false);
                        }}
                      >
                        {config.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Unit field - only for number type */}
            {DATA_TYPE_CONFIGS[formData.dataType]?.hasUnit && (
              <div className="form-group">
                <label>Unit:</label>
                <input 
                  type="text"
                  value={formData.unit}
                  onChange={(e) => updateFormData('unit', e.target.value)}
                  placeholder="°C, W, %, etc."
                  className="form-input"
                />
              </div>
            )}

            {/* Decimal precision - only for number type */}
            {DATA_TYPE_CONFIGS[formData.dataType]?.hasDecimalPrecision && (
              <div className="form-group">
                <label>Decimal Places:</label>
                <div className="custom-select-wrapper">
                  <button 
                    type="button" 
                    className="custom-select-button"
                    onClick={() => setDecimalDropdownOpen(!decimalDropdownOpen)}
                  >
                    <span className="select-value">
                      {formData.decimalPrecision}
                    </span>
                    <i className={`fas fa-chevron-down ${decimalDropdownOpen ? 'rotated' : ''}`}></i>
                  </button>
                  {decimalDropdownOpen && (
                    <div className="custom-select-dropdown">
                      {[0, 1, 2, 3, 4, 5].map(precision => (
                        <button 
                          key={precision}
                          type="button"
                          className={`dropdown-option ${formData.decimalPrecision === precision ? 'selected' : ''}`}
                          onClick={() => {
                            updateFormData('decimalPrecision', precision);
                            setDecimalDropdownOpen(false);
                          }}
                        >
                          {precision}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="timestamp-checkbox">
              <input 
                type="checkbox"
                checked={formData.includeTimestamp}
                onChange={(e) => updateFormData('includeTimestamp', e.target.checked)}
              />
              <i className="fas fa-clock"></i>
              Include timestamp
            </label>
          </div>

          {/* Generator Selection */}
          <div className="form-group">
            <label>Value Generator:</label>
            <div className="custom-select-wrapper">
              <button 
                type="button" 
                className="custom-select-button"
                onClick={() => setGeneratorDropdownOpen(!generatorDropdownOpen)}
              >
                <span className="select-value">
                  {GENERATOR_CONFIGS[formData.generator]?.label || formData.generator}
                </span>
                <i className={`fas fa-chevron-down ${generatorDropdownOpen ? 'rotated' : ''}`}></i>
              </button>
              {generatorDropdownOpen && (
                <div className="custom-select-dropdown">
                  {availableGenerators.map(generator => (
                    <button 
                      key={generator}
                      type="button"
                      className={`dropdown-option ${formData.generator === generator ? 'selected' : ''}`}
                      onClick={() => {
                        handleGeneratorChange(generator);
                        setGeneratorDropdownOpen(false);
                      }}
                    >
                      {GENERATOR_CONFIGS[generator]?.label || generator}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Configuration Fields */}
          <DynamicConfigFields 
            dataType={formData.dataType}
            generator={formData.generator}
            config={formData.config}
            onConfigChange={updateConfig}
          />

          {/* Live Preview */}
          <div className="preview-section">
            <label>Preview Value:</label>
            <div className="preview-value">
              {formatPreviewValue(previewValue)}
            </div>
          </div>
          
          <div className="form-actions">
            <button 
              type="button" 
              onClick={onClose} 
              className="btn btn-md btn-secondary"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-md btn-primary"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              Save Output
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditOutputModal;
