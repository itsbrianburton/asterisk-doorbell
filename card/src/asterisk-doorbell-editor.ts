import { LitElement, html, TemplateResult, css } from 'lit';
import { customElement, property, state } from 'lit/decorators';

@customElement('asterisk-doorbell-editor')
export class AsteriskDoorbellEditor extends LitElement {
    @property({ attribute: false }) public hass;
    @property() public lovelace;
    @state() private _config;
    @state() private _callStatusEntities: string[] = [];
    @state() private _confbridgeIdEntities: string[] = [];
    @state() private _extensionEntities: string[] = [];

    setConfig(config): void {
        this._config = config;
    }

    // When first updated, load entities
    firstUpdated() {
        this._loadEntities();
    }

    // Load the three types of global sensors
    private _loadEntities() {
        if (!this.hass) return;

        const callStatusEntities: string[] = [];
        const confbridgeIdEntities: string[] = [];
        const extensionEntities: string[] = [];

        // Find the three global sensor types
        Object.keys(this.hass.states).forEach(entityId => {
            const entity = this.hass.states[entityId];

            if (entityId.startsWith('sensor.') && entity.attributes) {
                // Look for asterisk doorbell sensors
                if (entityId.includes('asterisk_doorbell_call_status')) {
                    callStatusEntities.push(entityId);
                } else if (entityId.includes('asterisk_doorbell_confbridge_id')) {
                    confbridgeIdEntities.push(entityId);
                } else if (entityId.includes('asterisk_doorbell_extension')) {
                    extensionEntities.push(entityId);
                }
            }
        });

        this._callStatusEntities = callStatusEntities;
        this._confbridgeIdEntities = confbridgeIdEntities;
        this._extensionEntities = extensionEntities;
    }

    // Handle value changes
    private _valueChanged(ev): void {
        if (!this._config || !this.hass) {
            return;
        }

        const target = ev.target;
        if (target.configValue) {
            if (target.value === '') {
                const newConfig = { ...this._config };
                delete newConfig[target.configValue];
                this._config = newConfig;
            } else {
                this._config = {
                    ...this._config,
                    [target.configValue]: target.checked !== undefined ? target.checked : target.value,
                };
            }
        }

        // Dispatch config change event
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    }

    // Auto-fill the three sensors
    private _autoFillSensors() {
        if (!this.hass) return;

        const newConfig = { ...this._config };

        // Auto-detect the three sensors
        Object.keys(this.hass.states).forEach(entityId => {
            if (entityId.includes('asterisk_doorbell_call_status')) {
                newConfig.call_status_entity = entityId;
            } else if (entityId.includes('asterisk_doorbell_confbridge_id')) {
                newConfig.confbridge_id_entity = entityId;
            } else if (entityId.includes('asterisk_doorbell_extension')) {
                newConfig.extension_entity = entityId;
            }
        });

        this._config = newConfig;
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    }

    // Render the editor form
    render(): TemplateResult {
        if (!this.hass || !this._config) {
            return html``;
        }

        return html`
            <div class="card-config">
                <div class="values">
                    <ha-textfield
                        label="Title (Optional)"
                        .value="${this._config.header || ''}"
                        .configValue=${'header'}
                        @input=${this._valueChanged}
                    ></ha-textfield>
                    
                    <div class="auto-fill-section">
                        <ha-button @click="${this._autoFillSensors}" class="auto-fill">
                            Auto-Fill Sensors
                        </ha-button>
                        <p>Click to automatically detect the three Asterisk doorbell sensors</p>
                    </div>
                    
                    <ha-select
                        label="Call Status Entity (Required)"
                        .value="${this._config.call_status_entity || ''}"
                        .configValue=${'call_status_entity'}
                        @selected=${this._valueChanged}
                        @closed=${(ev) => ev.stopPropagation()}
                    >
                        ${this._callStatusEntities.map(
                            (entity) => {
                                const entityState = this.hass.states[entity];
                                const friendlyName = entityState?.attributes?.friendly_name || entity;
                                return html`<mwc-list-item .value=${entity}>${friendlyName}</mwc-list-item>`;
                            }
                        )}
                    </ha-select>
                    
                    <ha-select
                        label="Confbridge ID Entity (Required)"
                        .value="${this._config.confbridge_id_entity || ''}"
                        .configValue=${'confbridge_id_entity'}
                        @selected=${this._valueChanged}
                        @closed=${(ev) => ev.stopPropagation()}
                    >
                        ${this._confbridgeIdEntities.map(
                            (entity) => {
                                const entityState = this.hass.states[entity];
                                const friendlyName = entityState?.attributes?.friendly_name || entity;
                                return html`<mwc-list-item .value=${entity}>${friendlyName}</mwc-list-item>`;
                            }
                        )}
                    </ha-select>
                    
                    <ha-select
                        label="Extension Entity (Required)"
                        .value="${this._config.extension_entity || ''}"
                        .configValue=${'extension_entity'}
                        @selected=${this._valueChanged}
                        @closed=${(ev) => ev.stopPropagation()}
                    >
                        ${this._extensionEntities.map(
                            (entity) => {
                                const entityState = this.hass.states[entity];
                                const friendlyName = entityState?.attributes?.friendly_name || entity;
                                return html`<mwc-list-item .value=${entity}>${friendlyName}</mwc-list-item>`;
                            }
                        )}
                    </ha-select>
                    
                    ${this._config.call_status_entity && this._config.confbridge_id_entity && this._config.extension_entity ? 
                        html`
                            <div class="entity-info">
                                <h3>Selected Entities:</h3>
                                <p><strong>Call Status:</strong> ${this._config.call_status_entity}</p>
                                <p><strong>Confbridge ID:</strong> ${this._config.confbridge_id_entity}</p>
                                <p><strong>Extension:</strong> ${this._config.extension_entity}</p>
                                
                                ${this.hass.states[this._config.call_status_entity] ? 
                                    html`
                                        <h3>Current Values:</h3>
                                        <p><strong>Call Status:</strong> ${this.hass.states[this._config.call_status_entity].state}</p>
                                        <p><strong>Confbridge ID:</strong> ${this.hass.states[this._config.confbridge_id_entity].state || 'None'}</p>
                                        <p><strong>Extension:</strong> ${this.hass.states[this._config.extension_entity].state || 'None'}</p>
                                    ` : ''
                                }
                            </div>
                        ` : 
                        html`
                            <div class="warning">
                                <p><strong>Note:</strong> All three sensor entities are required for the card to function properly.</p>
                            </div>
                        `
                    }
                </div>
            </div>
        `;
    }

    static get styles() {
        return css`
            .card-config {
                padding: 16px;
            }
            
            .values {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            
            .auto-fill-section {
                margin: 16px 0;
                padding: 16px;
                border: 1px solid var(--divider-color);
                border-radius: 8px;
                text-align: center;
            }
            
            .auto-fill-section p {
                margin: 8px 0 0 0;
                color: var(--secondary-text-color);
                font-size: 0.9rem;
            }
            
            .entity-info {
                margin-top: 16px;
                padding: 16px;
                background: var(--card-background-color);
                border-radius: 8px;
            }
            
            .entity-info h3 {
                margin: 0 0 8px 0;
                color: var(--primary-text-color);
            }
            
            .entity-info p {
                margin: 4px 0;
                color: var(--secondary-text-color);
                font-size: 0.9rem;
            }
            
            .warning {
                margin-top: 16px;
                padding: 16px;
                background: var(--warning-color);
                color: var(--text-primary-color);
                border-radius: 8px;
            }
            
            .warning p {
                margin: 0;
            }
            
            ha-button.auto-fill {
                --mdc-theme-primary: var(--primary-color);
            }
        `;
    }
}