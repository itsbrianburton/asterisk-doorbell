import { LitElement, html, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators';

@customElement('asterisk-doorbell-editor')
export class AsteriskDoorbellEditor extends LitElement {
    @property({ attribute: false }) public hass;
    @property() public lovelace;
    @state() private _config;
    @state() private _helpers;
    @state() private _stateEntities: string[] = [];
    @state() private _extensionEntities: string[] = [];

    setConfig(config): void {
        this._config = config;
    }

    // When first updated, load entities
    firstUpdated() {
        this._loadEntities();
    }

    // Load relevant entities from Home Assistant
    private _loadEntities() {
        if (!this.hass) return;

        const stateEntities: string[] = [];
        const extensionEntities: string[] = [];

        // Find all relevant sensor entities
        Object.keys(this.hass.states).forEach(entityId => {
            if (entityId.startsWith('sensor.') && entityId.includes('_state')) {
                stateEntities.push(entityId);
            }
            if (entityId.startsWith('sensor.') && entityId.includes('_extension')) {
                extensionEntities.push(entityId);
            }
        });

        this._stateEntities = stateEntities;
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
                    
                    <ha-select
                        label="State Entity (Required)"
                        .value="${this._config.entity || ''}"
                        .configValue=${'entity'}
                        @selected=${this._valueChanged}
                        @closed=${(ev) => ev.stopPropagation()}
                    >
                        ${this._stateEntities.map(
                            (entity) => html`<mwc-list-item .value=${entity}>${entity}</mwc-list-item>`
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
                            (entity) => html`<mwc-list-item .value=${entity}>${entity}</mwc-list-item>`
                        )}
                    </ha-select>
                </div>
            </div>
        `;
    }
}