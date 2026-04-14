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
    debug?: boolean;
    theme?: 'large' | 'small';
    labels?: {
        ringing?: string;
        hangup?: string;
        inactive?: string;
    };
}

// Global registry to track which card is handling a call
const globalCallRegistry = {
    activeCardId: null as string | null,
    pendingSessions: new Map<string, RTCSession>(),

    registerActiveCard(cardId: string): boolean {
        if (this.activeCardId && this.activeCardId !== cardId) {
            return false; // Another card is already handling the call
        }
        this.activeCardId = cardId;
        return true;
    },

    releaseActiveCard(cardId: string): void {
        if (this.activeCardId === cardId) {
            this.activeCardId = null;
        }
    },

    isActiveCard(cardId: string): boolean {
        return this.activeCardId === cardId;
    },

    hasActiveCard(): boolean {
        return this.activeCardId !== null;
    },

    storePendingSession(cardId: string, session: RTCSession): void {
        this.pendingSessions.set(cardId, session);
    },

    removePendingSession(cardId: string): void {
        this.pendingSessions.delete(cardId);
    },

    terminateOtherPendingSessions(cardId: string): void {
        this.pendingSessions.forEach((session, id) => {
            if (id !== cardId) {
                try {
                    session.terminate();
                } catch (e) {
                    console.warn('Failed to terminate pending session:', e);
                }
            }
        });
        this.pendingSessions.clear();
    }
};

export class AsteriskDoorbellCard extends LitElement {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @state() private _config: Config = {} as Config;
    @state() private _header: string | typeof nothing | undefined;
    @state() private _callState: string = 'inactive';
    private _callStatusEntity: HassEntity | null = null;
    private _confbridgeIdEntity: HassEntity | null = null;
    private _extensionEntity: HassEntity | null = null;
    @state() private _confbridgeId: string = '';
    @state() private _extension: string = '';
    @state() private _isMuted: boolean = false;
    @state() private _isVolumeMuted: boolean = false;
    @state() private _videoVisible: boolean = false;
    @state() private _isConnecting: boolean = false;
    @state() private _hasPendingIncomingCall: boolean = false;

    // SIP/WebRTC properties
    private _socket: UA | null = null;
    private _session: RTCSession | null = null;
    private _settings: any = {};
    private _localStream: MediaStream | null = null;
    private _remoteAudioElement: HTMLAudioElement | null = null;
    private _remoteVideoElement: HTMLVideoElement | null = null;
    private _initializationAttempted: boolean = false;
    private _cardId: string;
    private _callConfig: any = {
        mediaConstraints: {
            audio: true,
            video: false
        },
        rtcOfferConstraints: {
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        }
    };

    constructor() {
        super();
        this._cardId = `card_${Math.random().toString(36).substr(2, 9)}`;
        this._initializeSIPWhenReady();
    }

    private async _initializeSIPWhenReady() {
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
        if (this._remoteAudioElement) {
            this._remoteAudioElement.remove();
        }
        if (this._remoteVideoElement) {
            this._remoteVideoElement.remove();
        }

        this._remoteAudioElement = document.createElement('audio');
        this._remoteAudioElement.autoplay = true;
        document.body.appendChild(this._remoteAudioElement);

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
                user_agent: `Asterisk Doorbell HA - ${this._cardId}`
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
        const session = event.session;

        // If this is an incoming call
        if (session.direction === 'incoming') {
            this._log("Incoming call received");

            // Check if another card is already handling a call
            if (globalCallRegistry.hasActiveCard() && !globalCallRegistry.isActiveCard(this._cardId)) {
                this._log("Another card is already handling a call, rejecting this one");
                session.terminate();
                return;
            }

            // If this card already has an active session, reject the new one
            if (this._session) {
                this._log("This card already has an active session, rejecting new one");
                session.terminate();
                return;
            }

            // Store as pending session - don't auto-answer
            globalCallRegistry.storePendingSession(this._cardId, session);
            this._hasPendingIncomingCall = true;
            this._session = session;

            // Set up event handlers but don't answer yet
            this._setupSessionHandlers(session);

            this._log("Incoming call pending - waiting for user to answer");
            this.requestUpdate();

        } else {
            // Outgoing call - handled by _handleAnswer, just store the reference.
            // Do NOT call _setupSessionHandlers here; _handleAnswer already does it
            // after ua.call() returns, avoiding duplicate event listeners.
            this._session = session;
        }
    }

    private _attachTrackHandler(peerconnection: RTCPeerConnection) {
        peerconnection.ontrack = (event) => {
            // On Android WebView, event.streams may be empty even when
            // event.track is valid. Fall back to creating a stream from the track.
            const stream = event.streams?.[0] || new MediaStream([event.track]);
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
                this._remoteAudioElement.play().catch(e => {
                    this._log("Audio autoplay blocked: " + e, "error");
                });
                this._log("Audio stream connected");
            }
        };

        const senders = peerconnection.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender && audioSender.track) {
            this._localStream = new MediaStream([audioSender.track]);
        }
    }

    private _setupSessionHandlers(session: RTCSession) {
        session
            .on('accepted', () => {
                this._log("WebRTC session accepted - audio/video connected");
                this._hasPendingIncomingCall = false;
                this.requestUpdate();
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
                this._attachTrackHandler(e.peerconnection);
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

        globalCallRegistry.releaseActiveCard(this._cardId);
        globalCallRegistry.removePendingSession(this._cardId);

        this._session = null;
        this._videoVisible = false;
        this._isMuted = false;
        this._isVolumeMuted = false;
        this._isConnecting = false;
        this._hasPendingIncomingCall = false;
        this.requestUpdate();
    }

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
        const previousCallState = changedProps.get('_callState');

        if (changedProps.has('hass') && this._config) {
            this._updateState();
        }

        // If call state changed to inactive and we have an active session, terminate it
        if (changedProps.has('_callState') &&
            this._callState === 'inactive' &&
            previousCallState !== 'inactive' &&
            this._session) {
            this._log("Call status changed to inactive, terminating session");
            this._handleHangup();
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
            const entity = this.hass.states[this._config.call_status_entity];
            if (entity && entity.state !== this._callState) {
                this._callStatusEntity = entity;
                this._callState = entity.state;
            }
        }

        if (this._config.confbridge_id_entity) {
            const entity = this.hass.states[this._config.confbridge_id_entity];
            if (entity && entity.state !== this._confbridgeId) {
                this._confbridgeIdEntity = entity;
                this._confbridgeId = entity.state;
            }
        }

        if (this._config.extension_entity) {
            const entity = this.hass.states[this._config.extension_entity];
            if (entity && entity.state !== this._extension) {
                this._extensionEntity = entity;
                this._extension = entity.state;
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

        // Register this card as the active handler
        if (!globalCallRegistry.registerActiveCard(this._cardId)) {
            this._log("Another card is already handling the call", "error");
            return;
        }

        // Terminate pending sessions on other cards
        globalCallRegistry.terminateOtherPendingSessions(this._cardId);

        console.log('Card: Answering call for confbridge:', this._confbridgeId);

        // Prime audio element with user gesture so browser allows playback later
        if (this._remoteAudioElement) {
            this._remoteAudioElement.play().catch(() => {});
        }

        this._isConnecting = true;
        this._hasPendingIncomingCall = false;
        this.requestUpdate();

        try {
            if (!this._socket) {
                console.error('SIP client not initialized. Attempting initialization...');
                await this._initializeSIP();
                if (!this._socket) {
                    console.error('SIP initialization failed');
                    this._isConnecting = false;
                    globalCallRegistry.releaseActiveCard(this._cardId);
                    this.requestUpdate();
                    return;
                }
            }

            if (!this._socket.isRegistered()) {
                console.error('SIP client not registered');
                this._isConnecting = false;
                globalCallRegistry.releaseActiveCard(this._cardId);
                this.requestUpdate();
                return;
            }

            // If we have a pending incoming call session, answer it
            if (this._session && this._session.direction === 'incoming') {
                this._log("Answering incoming call");
                this._session.answer(this._callConfig);
            } else {
                // Make outgoing call to join conference
                const callTarget = `sip:${this._extension}@${this._settings.asterisk_host}`;
                this._log(`Making outgoing call to: ${callTarget}`);

                this._session = this._socket.call(callTarget, this._callConfig);
                this._setupSessionHandlers(this._session);

                // Defensively attach ontrack on the already-created peer connection.
                // The peerconnection event in _setupSessionHandlers also does this,
                // but setting ontrack again is idempotent and guards against any
                // timing edge cases across JsSIP versions.
                const pc = this._session.connection;
                if (pc) {
                    this._attachTrackHandler(pc);
                }
            }

            setTimeout(() => {
                if (this._isConnecting) {
                    this._isConnecting = false;
                    this.requestUpdate();
                }
            }, 10000);

        } catch (error) {
            console.error('Failed to answer call:', error);
            this._isConnecting = false;
            globalCallRegistry.releaseActiveCard(this._cardId);
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

    private _handleVolumeMute() {
        if (!this._remoteAudioElement) return;

        this._isVolumeMuted = !this._isVolumeMuted;
        this._remoteAudioElement.muted = this._isVolumeMuted;
        this.requestUpdate();
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

    private _getSIPStatus(): string {
        if (!this._socket) return 'not_initialized';
        if (!this._socket.isRegistered()) return 'not_registered';
        return 'ready';
    }

    private _log(msg: any, type: string = "debug") {
        if (!this._config.debug && type === "debug") return;
        const prefix = `[ASTERISK_DOORBELL_CARD][${this._cardId}]`;
        if (type === "debug") {
            console.debug(prefix, msg);
        } else if (type === "error") {
            console.error(prefix, msg);
        } else if (type === "warning") {
            console.warn(prefix, msg);
        }
    }

    public getSIPStatus(): string {
        return this._getSIPStatus();
    }

    public getDiagnosticInfo() {
        return {
            cardId: this._cardId,
            socketExists: !!this._socket,
            socketStatus: this._socket ? (this._socket.isRegistered() ? 'registered' : 'not registered') : 'null',
            sessionExists: !!this._session,
            sessionDirection: this._session?.direction || 'none',
            settings: this._settings,
            hassConnected: !!this.hass,
            initializationAttempted: this._initializationAttempted,
            callState: this._callState,
            confbridgeId: this._confbridgeId,
            extension: this._extension,
            videoVisible: this._videoVisible,
            isMuted: this._isMuted,
            isVolumeMuted: this._isVolumeMuted,
            isConnecting: this._isConnecting,
            hasPendingIncomingCall: this._hasPendingIncomingCall,
            isActiveCard: globalCallRegistry.isActiveCard(this._cardId),
            globalActiveCardId: globalCallRegistry.activeCardId
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

    private _getLabel(state: 'ringing' | 'hangup' | 'inactive'): string {
        const defaults = { ringing: 'Answer', hangup: 'End Live', inactive: 'Idle' };
        return this._config.labels?.[state] || defaults[state];
    }

    render() {
        if (!this.hass || !this._config) {
            return html``;
        }

        const isThisCardActive = globalCallRegistry.isActiveCard(this._cardId);
        const shouldShowRinging = this._callState === 'ringing' || this._hasPendingIncomingCall;
        const isInCall = this._callState === 'active' && isThisCardActive && this._session;
        const isLarge = this._config.theme !== 'small';
        const sipStatus = this._getSIPStatus();

        // Determine call button state
        let callBtnIcon = 'mdi:phone-off';
        let callBtnLabel = this._getLabel('inactive');
        let callBtnClass = 'call-btn inactive';
        let callBtnDisabled = true;
        let callBtnHandler = () => {};

        if (this._isConnecting) {
            callBtnIcon = 'mdi:phone-clock';
            callBtnLabel = isLarge ? 'Connecting...' : '';
            callBtnClass = 'call-btn connecting';
            callBtnDisabled = true;
        } else if (shouldShowRinging && !globalCallRegistry.hasActiveCard()) {
            callBtnIcon = 'mdi:phone-ring';
            callBtnLabel = this._getLabel('ringing');
            callBtnClass = 'call-btn ringing';
            callBtnDisabled = false;
            callBtnHandler = () => this._handleAnswer();
        } else if (isInCall) {
            callBtnIcon = 'mdi:phone-hangup';
            callBtnLabel = this._getLabel('hangup');
            callBtnClass = 'call-btn active';
            callBtnDisabled = false;
            callBtnHandler = () => this._handleHangup();
        }

        return html`
            <ha-card>
                <div class="card-content">
                    ${isLarge ? html`
                        <!-- Large theme: rectangular call button on top -->
                        <button
                            class="${callBtnClass} pill"
                            ?disabled=${callBtnDisabled}
                            @click=${callBtnHandler}
                        >
                            <ha-icon icon="${callBtnIcon}"></ha-icon>
                            <span>${callBtnLabel}</span>
                        </button>

                        <div class="circle-row">
                            <button
                                class="circle-btn ${this._isMuted ? 'toggled' : ''}"
                                ?disabled=${!isInCall}
                                @click=${() => this._handleMute()}
                            >
                                <ha-icon icon="${this._isMuted ? 'mdi:microphone-off' : 'mdi:microphone'}"></ha-icon>
                            </button>

                            <button
                                class="circle-btn ${this._isVolumeMuted ? 'toggled' : ''}"
                                ?disabled=${!isInCall}
                                @click=${() => this._handleVolumeMute()}
                            >
                                <ha-icon icon="${this._isVolumeMuted ? 'mdi:volume-off' : 'mdi:volume-high'}"></ha-icon>
                            </button>
                        </div>
                    ` : html`
                        <!-- Small theme: all circular buttons in a row -->
                        <div class="circle-row">
                            <button
                                class="${callBtnClass} circle-btn"
                                ?disabled=${callBtnDisabled}
                                @click=${callBtnHandler}
                            >
                                <ha-icon icon="${callBtnIcon}"></ha-icon>
                            </button>

                            <button
                                class="circle-btn ${this._isMuted ? 'toggled' : ''}"
                                ?disabled=${!isInCall}
                                @click=${() => this._handleMute()}
                            >
                                <ha-icon icon="${this._isMuted ? 'mdi:microphone-off' : 'mdi:microphone'}"></ha-icon>
                            </button>

                            <button
                                class="circle-btn ${this._isVolumeMuted ? 'toggled' : ''}"
                                ?disabled=${!isInCall}
                                @click=${() => this._handleVolumeMute()}
                            >
                                <ha-icon icon="${this._isVolumeMuted ? 'mdi:volume-off' : 'mdi:volume-high'}"></ha-icon>
                            </button>
                        </div>
                    `}

                    ${this._config.debug ? html`
                    <div class="debug-panel">
                        Card ID: ${this._cardId} |
                        Call: ${this._callState} |
                        Confbridge: ${this._confbridgeId} |
                        Ext: ${this._extension} |
                        SIP: ${sipStatus} |
                        Session: ${!!this._session ? 'Y' : 'N'} |
                        Active: ${isThisCardActive ? 'Y' : 'N'} |
                        Pending: ${this._hasPendingIncomingCall ? 'Y' : 'N'} |
                        Connecting: ${this._isConnecting ? 'Y' : 'N'}
                    </div>
                    ` : ''}
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
            header: "",
            debug: false,
            theme: "large",
            labels: {
                ringing: "Answer",
                hangup: "End Live",
                inactive: "Idle"
            }
        };
    }

    static get styles() {
        return [
            css`
                :host {
                    display: block;
                }

                ha-card {
                    background: transparent;
                    border: none;
                    box-shadow: none;
                    padding: 0;
                }

                .card-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 1rem 0;
                    gap: 3rem;
                }

                /* ── Shared button base ── */
                button {
                    cursor: pointer;
                    border: none;
                    outline: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: background-color 0.2s, opacity 0.2s, box-shadow 0.2s;
                    -webkit-tap-highlight-color: transparent;
                    font-family: inherit;
                    font-size: 0.875rem;
                    font-weight: 500;
                    color: var(--primary-text-color);
                }

                button:disabled {
                    opacity: 0.35;
                    cursor: default;
                    pointer-events: none;
                }

                /* ── Pill (large rectangular) button ── */
                .pill {
                    font-size: 1rem;
                    gap: 0.5rem;
                    padding: 1rem 3rem;
                    border-radius: 0.5rem;
                    background: var(--card-background-color, rgba(255,255,255,0.08));
                }

                .pill ha-icon {
                    --mdc-icon-size: 20px;
                }

                /* ── Circle button ── */
                .circle-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: var(--card-background-color, rgba(255,255,255,0.08));
                    padding: 0;
                }

                .circle-btn ha-icon {
                    --mdc-icon-size: 22px;
                }

                .circle-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 3rem;
                }

                /* ── Call button states ── */
                .call-btn.inactive {
                    color: var(--secondary-text-color);
                }

                .call-btn.ringing {
                    background: var(--success-color, #4CAF50);
                    color: #fff;
                    animation: ring-pulse 1.5s ease-in-out infinite;
                }

                .call-btn.active {
                    background: var(--error-color, #F44336);
                    color: #fff;
                }

                .call-btn.connecting {
                    color: var(--secondary-text-color);
                }

                /* ── Toggled state for mic/volume ── */
                .circle-btn.toggled {
                    background: var(--error-color, #F44336);
                    color: #fff;
                }

                /* ── Hover/active feedback ── */
                button:not(:disabled):hover {
                    filter: brightness(1.15);
                }

                button:not(:disabled):active {
                    filter: brightness(0.9);
                }

                /* ── Animations ── */
                @keyframes ring-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4); }
                    50% { box-shadow: 0 0 0 10px rgba(76, 175, 80, 0); }
                }

                /* ── Debug panel ── */
                .debug-panel {
                    margin-top: 0.5rem;
                    padding: 0.5rem;
                    background: var(--card-background-color, rgba(0,0,0,0.3));
                    border-radius: 4px;
                    font-size: 0.7rem;
                    color: var(--secondary-text-color);
                    text-align: center;
                    word-break: break-all;
                }
            `
        ];
    }
}