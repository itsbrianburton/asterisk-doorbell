import { html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators';

import { HassEntity } from 'home-assistant-js-websocket';
import { HomeAssistant, LovelaceCardConfig } from 'custom-card-helpers';

interface Config extends LovelaceCardConfig {
    header: string;
    entity: string;
    extension_entity?: string;
}

export class AsteriskDoorbellCard extends LitElement {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @state() private _config: Config;
    @state() private _header: string | typeof nothing;
    @state() private _callState: string = 'idle';
    @state() private _callEntity: HassEntity | null = null;
    @state() private _extensionEntity: HassEntity | null = null;
    @state() private _callerName: string = '';
    @state() private _isMuted: boolean = false;

    private _session: any = {};

    constructor() {
        super();
        this._session = (window as any).asterisk_doorbell;
    }

    // This is called when the configuration changes
    setConfig(config: Config) {
        if (!config.entity) {
            throw new Error('You need to define an entity');
        }

        this._config = config;
        this._header = config.header === "" ? nothing : config.header;
    }

    // When Home Assistant state changes
    updated(changedProps: any) {
        if (changedProps.has('hass') && this._config) {
            this._updateState();
        }
    }

    // Update internal state based on Home Assistant entities
    private _updateState() {
        if (!this.hass || !this._config.entity) return;

        const callEntity = this.hass.states[this._config.entity];

        if (callEntity) {
            this._callEntity = callEntity;

            // Get the call state (active, ringing, inactive)
            const state = callEntity.state;
            this._callState = state;

            // Check if we have an extension entity
            if (this._config.extension_entity && this.hass.states[this._config.extension_entity]) {
                this._extensionEntity = this.hass.states[this._config.extension_entity];

                // Get the caller name (if any)
                const deviceName = this._extensionEntity.attributes.friendly_name || '';
                if (deviceName) {
                    this._callerName = deviceName.replace(' Extension', '');
                }
            }
        }
    }

    // Answer the call
    private _handleAnswer() {
        if (!this._extensionEntity) return;

        const extension = this._extensionEntity.state;
        const bridgeId = this._extensionEntity.attributes.bridge_id;

        if (extension && bridgeId) {
            this._session.answer(bridgeId, extension);
        }
    }

    // Toggle microphone mute
    private _handleMute() {
        this._isMuted = !this._isMuted;
        this._session.toggleMute(this._isMuted);
    }

    // Hang up the call
    private _handleHangup() {
        if (!this._callEntity) return;

        const bridgeId = this._callEntity.attributes.bridge_id;

        if (bridgeId) {
            this._session.terminate(bridgeId);
        }
    }

    // Card rendering
    render() {
        if (!this.hass || !this._config) {
            return html``;
        }

        // Determine the card status styling
        let statusClass = 'status-inactive';
        if (this._callState === 'active') {
            statusClass = 'status-active';
        } else if (this._callState === 'ringing') {
            statusClass = 'status-ringing';
        }

        return html`
            <ha-card header="${this._header || 'Doorbell'}">
                <div class="card-content ${statusClass}">
                    ${this._callState !== 'inactive' ? 
                        html`
                            <div class="caller-info">
                                <h2>${this._callerName || 'Doorbell'} ${this._callState === 'ringing' ? ' is calling...' : ''}</h2>
                            </div>
                        ` : 
                        html`
                            <div class="caller-info">
                                <h2>No active calls</h2>
                            </div>
                        `
                    }
                    
                    <div class="button-container">
                        ${this._callState === 'ringing' ? 
                            html`
                                <ha-button @click="${this._handleAnswer}" class="answer">
                                    <ha-icon icon="mdi:phone"></ha-icon> Answer
                                </ha-button>
                            ` : ''
                        }
                        
                        ${this._callState === 'active' ? 
                            html`
                                <ha-button @click="${this._handleMute}" class="${this._isMuted ? 'muted' : 'unmuted'}">
                                    <ha-icon icon="${this._isMuted ? 'mdi:microphone-off' : 'mdi:microphone'}"></ha-icon>
                                    ${this._isMuted ? 'Unmute' : 'Mute'}
                                </ha-button>
                            ` : ''
                        }
                        
                        ${this._callState !== 'inactive' ? 
                            html`
                                <ha-button @click="${this._handleHangup}" class="hangup">
                                    <ha-icon icon="mdi:phone-hangup"></ha-icon> Hang Up
                                </ha-button>
                            ` : ''
                        }
                    </div>
                </div>
            </ha-card>
        `;
    }

    static getConfigElement() {
        return document.createElement("asterisk-doorbell-editor");
    }

    static getStubConfig() {
        return {
            entity: "",
            extension_entity: "",
            header: "Doorbell"
        };
    }

    static get styles() {
        return [
            // Styles go here
        ];
    }
}

// Register the card
customElements.define("asterisk-doorbell-card", AsteriskDoorbellCard);