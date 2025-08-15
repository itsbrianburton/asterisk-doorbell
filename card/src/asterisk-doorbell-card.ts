import { html, LitElement, nothing, css } from 'lit';
import { property, state } from 'lit/decorators';

import { HassEntity } from 'home-assistant-js-websocket';
import { HomeAssistant, LovelaceCardConfig } from 'custom-card-helpers';

interface Config extends LovelaceCardConfig {
    header?: string;
    call_status_entity?: string;
    confbridge_id_entity?: string;
    extension_entity?: string;
}

export class AsteriskDoorbellCard extends LitElement {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @state() private _config: Config = {} as Config;
    @state() private _header: string | typeof nothing | undefined;
    @state() private _callState: string = 'inactive';
    @state() private _callStatusEntity: HassEntity | null = null;
    @state() private _confbridgeIdEntity: HassEntity | null = null;
    @state() private _extensionEntity: HassEntity | null = null;
    @state() private _confbridgeId: string = '';
    @state() private _extension: string = '';
    @state() private _isMuted: boolean = false;
    @state() private _videoVisible: boolean = false;

    private _session: any = {};

    constructor() {
        super();
        this._session = (window as any).asterisk_doorbell;

        // Listen for WebRTC events
        if (this._session) {
            this._session.addEventListener('video_stream_ready', (e: any) => {
                this._videoVisible = true;
                this.requestUpdate();
            });

            this._session.addEventListener('media_disconnected', () => {
                this._videoVisible = false;
                this._isMuted = false;
                this.requestUpdate();
            });
        }
    }

    // This is called when the configuration changes
    setConfig(config: Config) {
        // Create a mutable copy of the config to avoid readonly errors
        this._config = { ...config };
        this._header = config.header === "" ? nothing : config.header;

        // Auto-detect the three global sensors if not configured
        if (!this._config.call_status_entity || !this._config.confbridge_id_entity || !this._config.extension_entity) {
            this._autoDetectSensors();
        }
    }

    // Auto-detect the three global sensors
    private _autoDetectSensors() {
        if (!this.hass) return;

        // Create a new config object to avoid modifying readonly properties
        const newConfig = { ...this._config };

        // Look for the three global sensors
        Object.keys(this.hass.states).forEach(entityId => {
            if (entityId.includes('asterisk_doorbell_call_status')) {
                newConfig.call_status_entity = entityId;
            } else if (entityId.includes('asterisk_doorbell_confbridge_id')) {
                newConfig.confbridge_id_entity = entityId;
            } else if (entityId.includes('asterisk_doorbell_extension')) {
                newConfig.extension_entity = entityId;
            }
        });

        // Update the config
        this._config = newConfig;
    }

    // When Home Assistant state changes
    updated(changedProps: any) {
        if (changedProps.has('hass') && this._config) {
            this._updateState();
        }

        // Handle video element placement
        if (this._videoVisible && this._session) {
            this._placeVideoElement();
        }
    }

    private _placeVideoElement() {
        const videoContainer = this.shadowRoot?.querySelector('#doorbell-video');
        const videoElement = this._session?.getVideoElement();

        if (videoContainer && videoElement && !videoContainer.contains(videoElement)) {
            videoElement.style.width = '100%';
            videoElement.style.height = 'auto';
            videoElement.style.maxHeight = '300px';
            videoContainer.appendChild(videoElement);
            this._session.setVideoVisible(true);
        }
    }

    // Update internal state based on the three global sensors
    private _updateState() {
        if (!this.hass) return;

        // Auto-detect sensors if not configured
        if (!this._config.call_status_entity || !this._config.confbridge_id_entity || !this._config.extension_entity) {
            this._autoDetectSensors();
        }

        // Get the three sensor entities
        if (this._config.call_status_entity) {
            this._callStatusEntity = this.hass.states[this._config.call_status_entity];
            if (this._callStatusEntity) {
                this._callState = this._callStatusEntity.state;
                console.log('Card: Call state updated to:', this._callState);
            }
        }

        if (this._config.confbridge_id_entity) {
            this._confbridgeIdEntity = this.hass.states[this._config.confbridge_id_entity];
            if (this._confbridgeIdEntity) {
                this._confbridgeId = this._confbridgeIdEntity.state;
                console.log('Card: Confbridge ID updated to:', this._confbridgeId);
            }
        }

        if (this._config.extension_entity) {
            this._extensionEntity = this.hass.states[this._config.extension_entity];
            if (this._extensionEntity) {
                this._extension = this._extensionEntity.state;
                console.log('Card: Extension updated to:', this._extension);
            }
        }
    }

    // Answer the call - call the admin extension directly via JSSIP
    private async _handleAnswer() {
        if (!this._confbridgeId) {
            console.error('No confbridge ID available');
            return;
        }

        console.log('Card: Answering call for confbridge:', this._confbridgeId);

        try {
            // Check session status first
            if (this._session) {
                const diagnostics = this._session.getDiagnosticInfo();
                console.log('Session diagnostic info:', diagnostics);

                if (!diagnostics.socketExists) {
                    console.error('SIP client not initialized. Attempting manual initialization...');
                    const success = await this._session.manualInitialize();
                    if (!success) {
                        console.error('Manual initialization failed');
                        return;
                    }
                }
            }

            // Call admin extension directly to join confbridge
            if (this._session) {
                await this._session.answerCall(this._confbridgeId);
            }
        } catch (error) {
            console.error('Failed to answer call:', error);
        }
    }

    // Toggle microphone mute
    private async _handleMute() {
        if (!this._session) return;

        this._isMuted = !this._isMuted;
        await this._session.toggleMute(this._isMuted);
    }

    // Hang up the call
    private async _handleHangup() {
        console.log('Card: Hanging up call');

        try {
            if (this._session) {
                await this._session.hangupCall();
            }
        } catch (error) {
            console.error('Failed to hang up call:', error);
        }
    }

    // Get display name for the confbridge
    private _getDisplayName(): string {
        if (!this._confbridgeId) return 'Doorbell';

        // Convert confbridge ID to display name
        // e.g., "doorbell_front_door" -> "Front Door"
        return this._confbridgeId
            .replace('doorbell_', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
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

        const displayName = this._getDisplayName();

        console.log('Card: Rendering with state:', {
            callState: this._callState,
            confbridgeId: this._confbridgeId,
            extension: this._extension,
            statusClass: statusClass
        });

        return html`
            <ha-card header="${this._header || 'Doorbell'}">
                <div class="card-content ${statusClass}">
                    ${this._callState !== 'inactive' ? 
                        html`
                            <div class="caller-info">
                                <h2>${displayName} ${this._callState === 'ringing' ? ' is calling...' : ' - Connected'}</h2>
                                ${this._extension ? html`<p>Extension: ${this._extension}</p>` : ''}
                                ${this._confbridgeId ? html`<p>Confbridge: ${this._confbridgeId}</p>` : ''}
                            </div>
                            
                            ${this._videoVisible ? 
                                html`
                                    <div class="video-container">
                                        <div id="doorbell-video"></div>
                                    </div>
                                ` : ''
                            }
                        ` : 
                        html`
                            <div class="caller-info">
                                <h2>${displayName}</h2>
                                <p>No active calls</p>
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
                    
                    <!-- Debug info (remove in production) -->
                    <div style="margin-top: 16px; padding: 8px; background: var(--card-background-color); border-radius: 4px; font-size: 0.8rem; color: var(--secondary-text-color);">
                        <strong>Debug:</strong><br>
                        Call Status: ${this._callState}<br>
                        Confbridge: ${this._confbridgeId}<br>
                        Extension: ${this._extension}<br>
                        Entities: ${this._config.call_status_entity ? '✓' : '✗'} ${this._config.confbridge_id_entity ? '✓' : '✗'} ${this._config.extension_entity ? '✓' : '✗'}<br>
                        SIP Status: ${this._session ? (this._session.getDiagnosticInfo ? JSON.stringify(this._session.getDiagnosticInfo()) : 'No diagnostics') : 'No session'}
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
            call_status_entity: "",
            confbridge_id_entity: "",
            extension_entity: "",
            header: "Doorbell"
        };
    }

    static get styles() {
        return [
            css`
                :host {
                    display: block;
                }
                
                ha-card {
                    padding-bottom: 16px;
                    position: relative;
                    overflow: hidden;
                }
                
                .card-content {
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                
                .caller-info {
                    width: 100%;
                    text-align: center;
                    margin-bottom: 24px;
                }
                
                .caller-info h2 {
                    margin: 0;
                    font-size: 1.5rem;
                    font-weight: 400;
                }
                
                .caller-info p {
                    margin: 8px 0 0 0;
                    color: var(--secondary-text-color);
                    font-size: 0.9rem;
                }
                
                .button-container {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    gap: 12px;
                    width: 100%;
                }
                
                ha-button {
                    min-width: 110px;
                    --mdc-theme-primary: var(--primary-color);
                }
                
                ha-button.answer {
                    --mdc-theme-primary: var(--success-color, #4CAF50);
                }
                
                ha-button.hangup {
                    --mdc-theme-primary: var(--error-color, #F44336);
                }
                
                ha-button.muted {
                    --mdc-theme-primary: var(--warning-color, #FF9800);
                }
                
                .status-ringing {
                    animation: pulse 1.5s infinite;
                }
                
                .status-active {
                    border-left: 4px solid var(--success-color, #4CAF50);
                }
                
                .video-container {
                    width: 100%;
                    margin: 16px 0;
                    border-radius: 8px;
                    overflow: hidden;
                    background: #000;
                }
                
                .video-container video {
                    width: 100%;
                    height: auto;
                    display: block;
                }
                
                @keyframes pulse {
                    0% {
                        border-left: 4px solid transparent;
                    }
                    50% {
                        border-left: 4px solid var(--warning-color, #FF9800);
                    }
                    100% {
                        border-left: 4px solid transparent;
                    }
                }
                
                @media (max-width: 600px) {
                    .button-container {
                        flex-direction: column;
                        align-items: stretch;
                    }
                    
                    ha-button {
                        width: 100%;
                    }
                }
            `
        ];
    }
}

// Register the card
customElements.define("asterisk-doorbell-card", AsteriskDoorbellCard);