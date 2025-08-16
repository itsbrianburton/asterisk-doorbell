// @ts-ignore
import { UA, WebSocketInterface } from 'jssip';
import { RTCSessionEvent } from 'jssip/lib/UA';
import { IncomingEvent, OutgoingEvent, RTCSession } from "jssip/lib/RTCSession";

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
    @state() private _isConnecting: boolean = false;

    // SIP/WebRTC properties
    private _socket: UA | null = null;
    private _session: RTCSession | null = null;
    private _settings: any = {};
    private _localStream: MediaStream | null = null;
    private _remoteAudioElement: HTMLAudioElement | null = null;
    private _remoteVideoElement: HTMLVideoElement | null = null;
    private _initializationAttempted: boolean = false;
    private _callConfig: any = {
        mediaConstraints: {
            audio: true,
            video: true
        },
        rtcOfferConstraints: {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        }
    };

    constructor() {
        super();
        this._initializeSIPWhenReady();
    }

    private async _initializeSIPWhenReady() {
        // Wait for the card to be ready and hass to be available
        await this.updateComplete;
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            await this._initializeSIP();
            this._log("SIP initialization completed successfully");
        } catch (e) {
            this._log("SIP initialization failed: " + e, "error");
            this._log("Will retry in 10 seconds", "error");
            setTimeout(() => this._initializeSIPWhenReady(), 10000);
        }
    }

    private async _initializeSIP() {
        if (this._initializationAttempted) {
            this._log("SIP initialization already attempted, resetting...");
            this._socket = null;
            this._session = null;
        }
        this._initializationAttempted = true;

        if (!this.hass) {
            throw new Error("Home Assistant not available");
        }

        try {
            this._log("Step 1: Initializing configuration...");
            await this._initializeConfig();
            this._log("Step 1: ✓ Configuration loaded");

            this._log("Step 2: Initializing media elements...");
            this._initializeMediaElements();
            this._log("Step 2: ✓ Media elements ready");

            this._log("Step 3: Initializing SIP connection...");
            this._initializeSIPConnection();
            this._log("Step 3: ✓ SIP connection initiated");

        } catch (e) {
            this._log("Error during SIP initialization: " + e, "error");
            throw e;
        }
    }

    private _initializeMediaElements() {
        // Create audio element for remote audio
        this._remoteAudioElement = document.createElement('audio');
        this._remoteAudioElement.autoplay = true;
        document.body.appendChild(this._remoteAudioElement);

        // Create video element for remote video (doorbell camera)
        this._remoteVideoElement = document.createElement('video');
        this._remoteVideoElement.autoplay = true;
        this._remoteVideoElement.style.display = 'none';
        document.body.appendChild(this._remoteVideoElement);
    }

    private async _initializeConfig() {
        try {
            this._log("Attempting to get settings from Home Assistant...");
            this._settings = await this.hass.callWS({
                type: "asterisk_doorbell/get_settings"
            });
            this._log("✓ Received settings from HA:", this._settings);

            if (!this._settings || !this._settings.asterisk_host || !this._settings.websocket_port) {
                this._log("⚠️ Invalid settings received, using fallback", "warning");
                throw new Error("Invalid settings from HA");
            }

        } catch (e) {
            this._log("✗ Failed to get settings from HA: " + e, "error");
            this._log("Using fallback settings", "warning");
            this._settings = {
                asterisk_host: window.location.hostname,
                websocket_port: 8089,
            };
            this._log("Fallback settings:", this._settings);
        }
    }

    private _initializeSIPConnection() {
        if (!this._settings.asterisk_host || !this._settings.websocket_port) {
            this._log("Missing SIP settings", "error");
            return;
        }

        const haHost = window.location.hostname;
        const haPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
        const haProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const proxyUrl = `${haProtocol}//${haHost}:${haPort}/api/asterisk_doorbell/ws`;

        this._log(`Using HA WebSocket proxy: ${proxyUrl}`);

        try {
            const socket = new WebSocketInterface(proxyUrl);

            this._socket = new UA({
                sockets: [socket],
                uri: `sip:homeassistant@${this._settings.asterisk_host}`,
                authorization_user: "homeassistant",
                password: "",
                register: true,
                register_expires: 300,
                session_timers: false,
                user_agent: 'Asterisk Doorbell HA'
            });

            this._socket
                .on('registered', () => {
                    this._log("✓ SIP client registered successfully");
                    this.requestUpdate();
                })
                .on('registrationFailed', (e) => {
                    this._log("✗ SIP registration failed: " + JSON.stringify(e), "error");
                })
                .on('newRTCSession', (event: RTCSessionEvent) => this._handleNewRTCSession(event))
                .on('connected', () => {
                    this._log("✓ SIP WebSocket connected");
                })
                .on('disconnected', () => {
                    this._log("✗ SIP WebSocket disconnected", "error");
                });

            this._socket.start();

        } catch (error) {
            this._log("Error creating SIP client: " + error, "error");
            this._socket = null;
        }
    }

    private _handleNewRTCSession(event: RTCSessionEvent) {
        if (this._session) {
            this._log("Already have active session, rejecting new one");
            event.session.terminate();
            return;
        }

        this._session = event.session;

        this._session
            .on('accepted', () => {
                this._log("WebRTC session accepted - audio/video connected");
            })
            .on('ended', () => {
                this._log("WebRTC session ended");
                this._cleanupSession();
            })
            .on('failed', (e) => {
                this._log("WebRTC session failed: " + e.cause, "error");
                this._cleanupSession();
            })
            .on('peerconnection', (e) => {
                const peerconnection = e.peerconnection;

                peerconnection.ontrack = (event) => {
                    if (event.streams && event.streams[0]) {
                        const stream = event.streams[0];
                        const videoTracks = stream.getVideoTracks();
                        const audioTracks = stream.getAudioTracks();

                        if (videoTracks.length > 0 && this._remoteVideoElement) {
                            this._remoteVideoElement.srcObject = stream;
                            this._log("Video stream connected");
                            this._videoVisible = true;
                            this.requestUpdate();
                        }

                        if (audioTracks.length > 0 && this._remoteAudioElement) {
                            this._remoteAudioElement.srcObject = stream;
                            this._log("Audio stream connected");
                        }
                    }
                };

                const senders = peerconnection.getSenders();
                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                if (audioSender && audioSender.track) {
                    this._localStream = new MediaStream([audioSender.track]);
                }
            });
    }

    private _cleanupSession() {
        if (this._localStream) {
            this._localStream.getTracks().forEach(track => track.stop());
            this._localStream = null;
        }

        if (this._remoteAudioElement) {
            this._remoteAudioElement.srcObject = null;
        }

        if (this._remoteVideoElement) {
            this._remoteVideoElement.srcObject = null;
            this._remoteVideoElement.style.display = 'none';
        }

        this._session = null;
        this._videoVisible = false;
        this._isMuted = false;
        this._isConnecting = false;
        this.requestUpdate();
    }

    // This is called when the configuration changes
    setConfig(config: Config) {
        this._config = { ...config };
        this._header = config.header === "" ? nothing : config.header;

        if (!this._config.call_status_entity || !this._config.confbridge_id_entity || !this._config.extension_entity) {
            this._autoDetectSensors();
        }
    }

    private _autoDetectSensors() {
        if (!this.hass) return;

        const newConfig = { ...this._config };

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
    }

    updated(changedProps: any) {
        if (changedProps.has('hass') && this._config) {
            this._updateState();
        }

        if (this._videoVisible) {
            this._placeVideoElement();
        }
    }

    private _placeVideoElement() {
        const videoContainer = this.shadowRoot?.querySelector('#doorbell-video');
        const videoElement = this._remoteVideoElement;

        if (videoContainer && videoElement && !videoContainer.contains(videoElement)) {
            videoElement.style.width = '100%';
            videoElement.style.height = 'auto';
            videoElement.style.maxHeight = '300px';
            videoElement.style.display = 'block';
            videoContainer.appendChild(videoElement);
        }
    }

    private _updateState() {
        if (!this.hass) return;

        if (!this._config.call_status_entity || !this._config.confbridge_id_entity || !this._config.extension_entity) {
            this._autoDetectSensors();
        }

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

    private async _handleAnswer() {
        if (!this._confbridgeId) {
            console.error('No confbridge ID available');
            return;
        }

        if (!this._extension) {
            console.error('No extension available');
            return;
        }

        console.log('Card: Answering call for confbridge:', this._confbridgeId);

        // Set loading state
        this._isConnecting = true;
        this.requestUpdate();

        try {
            if (!this._socket) {
                console.error('SIP client not initialized. Attempting initialization...');
                await this._initializeSIP();
                if (!this._socket) {
                    console.error('SIP initialization failed');
                    this._isConnecting = false;
                    this.requestUpdate();
                    return;
                }
            }

            if (!this._socket.isRegistered()) {
                console.error('SIP client not registered');
                this._isConnecting = false;
                this.requestUpdate();
                return;
            }

            const callTarget = `sip:${this._extension}@${this._settings.asterisk_host}`;
            this._log(`Answering call by calling admin extension: ${callTarget}`);

            this._session = this._socket.call(callTarget, this._callConfig);

            // Set up session event handlers for this specific session
            this._session.on('connecting', () => {
                this._log("Call connecting...");
            });

            this._session.on('progress', () => {
                this._log("Call in progress...");
            });

            this._session.on('accepted', () => {
                this._log("Call accepted");
                this._isConnecting = false;
                this.requestUpdate();
            });

            this._session.on('failed', () => {
                this._log("Call failed", "error");
                this._isConnecting = false;
                this.requestUpdate();
            });

            // Stop loading after a few seconds regardless (fallback)
            setTimeout(() => {
                if (this._isConnecting) {
                    this._isConnecting = false;
                    this.requestUpdate();
                }
            }, 10000);

        } catch (error) {
            console.error('Failed to answer call:', error);
            this._isConnecting = false;
            this.requestUpdate();
        }
    }

    private async _handleMute() {
        if (!this._session) {
            this._log("No active session to mute", "error");
            return;
        }

        try {
            this._isMuted = !this._isMuted;

            if (this._isMuted) {
                await this._session.mute({ audio: true, video: false });
            } else {
                await this._session.unmute({ audio: true, video: false });
            }

            this.requestUpdate();
        } catch (e) {
            this._log("Error toggling mute: " + e, "error");
        }
    }

    private async _handleHangup() {
        console.log('Card: Hanging up call');

        if (this._session) {
            try {
                this._session.terminate();
            } catch (error) {
                console.error('Failed to hang up call:', error);
            }
        }
    }

    private _getDisplayName(): string {
        if (!this._confbridgeId) return 'Doorbell';

        return this._confbridgeId
            .replace('doorbell_', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    private _getSIPStatus(): string {
        if (!this._socket) return 'not_initialized';
        if (!this._socket.isRegistered()) return 'not_registered';
        return 'ready';
    }

    private _log(msg: any, type: string = "debug") {
        const prefix = "[ASTERISK_DOORBELL_CARD]";
        if (type === "debug") {
            console.debug(prefix, msg);
        } else if (type === "error") {
            console.error(prefix, msg);
        } else if (type === "warning") {
            console.warn(prefix, msg);
        }
    }

    // Public debug methods for external access
    public getSIPStatus(): string {
        return this._getSIPStatus();
    }

    public getDiagnosticInfo() {
        return {
            socketExists: !!this._socket,
            socketStatus: this._socket ? (this._socket.isRegistered() ? 'registered' : 'not registered') : 'null',
            sessionExists: !!this._session,
            settings: this._settings,
            hassConnected: !!this.hass,
            initializationAttempted: this._initializationAttempted,
            callState: this._callState,
            confbridgeId: this._confbridgeId,
            extension: this._extension,
            videoVisible: this._videoVisible,
            isMuted: this._isMuted,
            isConnecting: this._isConnecting
        };
    }

    public isReady(): boolean {
        return !!(this._socket && this._socket.isRegistered());
    }

    public async manualInitialize(): Promise<boolean> {
        try {
            await this._initializeSIP();
            return true;
        } catch (e) {
            this._log("Manual initialization failed: " + e, "error");
            return false;
        }
    }

    render() {
        if (!this.hass || !this._config) {
            return html``;
        }

        let statusClass = 'status-inactive';
        if (this._callState === 'active') {
            statusClass = 'status-active';
        } else if (this._callState === 'ringing') {
            statusClass = 'status-ringing';
        }

        const displayName = this._getDisplayName();
        const sipStatus = this._getSIPStatus();

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
                        SIP Status: ${sipStatus}<br>
                        Has Session: ${!!this._session ? '✓' : '✗'}<br>
                        Connecting: ${this._isConnecting ? '✓' : '✗'}
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
                
                .connecting-message {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 16px;
                    color: var(--primary-color);
                }
                
                .connecting-message p {
                    margin: 0;
                    font-size: 0.9rem;
                    color: var(--secondary-text-color);
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