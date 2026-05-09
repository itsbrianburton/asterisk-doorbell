import { RTCSession } from 'jssip/lib/RTCSession';

import { html, LitElement, nothing, css } from 'lit';
import { property, state } from 'lit/decorators';

import { HassEntity } from 'home-assistant-js-websocket';
import { HomeAssistant, LovelaceCardConfig } from 'custom-card-helpers';

import { SIPManager, SIPManagerEvent, SIPStatus } from './sip-manager';

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
    @state() private _sipStatus: SIPStatus = 'not_initialized';

    // Media elements owned by this card (browser audio/video must live in the DOM)
    private _localStream: MediaStream | null = null;
    private _remoteAudioElement: HTMLAudioElement | null = null;
    private _remoteVideoElement: HTMLVideoElement | null = null;

    // Reference to the singleton and the current session this card is handling
    private _manager: SIPManager = SIPManager.getInstance();
    private _unsubscribe: (() => void) | null = null;
    private _pendingIncomingSession: RTCSession | null = null;
    private _activeSession: RTCSession | null = null;
    private _cardId: string;
    private _callConfig: any = {
        mediaConstraints: {
            audio: true,
            video: false,
        },
        rtcOfferConstraints: {
            offerToReceiveAudio: true,
            offerToReceiveVideo: false,
        },
    };

    constructor() {
        super();
        this._cardId = `card_${Math.random().toString(36).substr(2, 9)}`;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    connectedCallback() {
        super.connectedCallback();

        // Subscribe to the singleton's events
        this._unsubscribe = this._manager.subscribe((event) => this._onManagerEvent(event));

        // Create media elements for this card instance
        this._initializeMediaElements();

        // Feed current hass to the manager (keeps its reference fresh).
        // The manager was already initialized at script load time;
        // this just ensures it has the latest hass if the card mounts
        // after a reconnect or if the bootstrap hadn't found hass yet.
        if (this.hass) {
            this._manager.setHass(this.hass);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();

        // Unsubscribe from manager events
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }

        // Clean up media elements we own
        this._cleanupMedia();

        // If this card was handling a session, release it
        if (this._activeSession) {
            // Don't terminate — another card might pick it up, or the
            // manager will clean up if nobody is listening.
            this._activeSession = null;
        }
        this._pendingIncomingSession = null;
    }

    // ── Manager event handler ─────────────────────────────────────────────

    private _onManagerEvent(event: SIPManagerEvent) {
        switch (event.type) {
            case 'status_changed':
                this._sipStatus = event.status;
                this.requestUpdate();
                break;

            case 'incoming_call':
                // Only accept if we're not already busy
                if (!this._activeSession && !this._pendingIncomingSession) {
                    this._pendingIncomingSession = event.session;
                    this._hasPendingIncomingCall = true;
                    this._log('Incoming call pending — waiting for user to answer');
                    this.requestUpdate();
                }
                break;

            case 'session_ended':
                this._cleanupSession();
                break;

            case 'session_failed':
                this._log('Session failed: ' + event.cause, 'error');
                this._cleanupSession();
                break;

            case 'log':
                // Forward manager logs to debug panel if debug is on
                if (this._config.debug) {
                    if (event.level === 'error') console.error(`[Card ${this._cardId}]`, event.message);
                    else console.debug(`[Card ${this._cardId}]`, event.message);
                }
                break;
        }
    }

    // ── Media elements ────────────────────────────────────────────────────

    private _initializeMediaElements() {
        if (this._remoteAudioElement) return; // Already created

        this._remoteAudioElement = document.createElement('audio');
        this._remoteAudioElement.autoplay = true;
        document.body.appendChild(this._remoteAudioElement);

        this._remoteVideoElement = document.createElement('video');
        this._remoteVideoElement.autoplay = true;
        this._remoteVideoElement.style.display = 'none';
        document.body.appendChild(this._remoteVideoElement);
    }

    private _cleanupMedia() {
        if (this._localStream) {
            this._localStream.getTracks().forEach((t) => t.stop());
            this._localStream = null;
        }
        if (this._remoteAudioElement) {
            this._remoteAudioElement.srcObject = null;
            this._remoteAudioElement.remove();
            this._remoteAudioElement = null;
        }
        if (this._remoteVideoElement) {
            this._remoteVideoElement.srcObject = null;
            this._remoteVideoElement.remove();
            this._remoteVideoElement = null;
        }
    }

    private _attachTrackHandler(peerconnection: RTCPeerConnection) {
        peerconnection.ontrack = (event) => {
            const stream = event.streams?.[0] || new MediaStream([event.track]);
            const videoTracks = stream.getVideoTracks();
            const audioTracks = stream.getAudioTracks();

            if (videoTracks.length > 0 && this._remoteVideoElement) {
                this._remoteVideoElement.srcObject = stream;
                this._log('Video stream connected');
                this._videoVisible = true;
                this.requestUpdate();
            }

            if (audioTracks.length > 0 && this._remoteAudioElement) {
                this._remoteAudioElement.srcObject = stream;
                this._remoteAudioElement.play().catch((e) => {
                    this._log('Audio autoplay blocked: ' + e, 'error');
                });
                this._log('Audio stream connected');
            }
        };

        const senders = peerconnection.getSenders();
        const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
        if (audioSender?.track) {
            this._localStream = new MediaStream([audioSender.track]);
        }
    }

    // ── Session cleanup ───────────────────────────────────────────────────

    private _cleanupSession() {
        if (this._localStream) {
            this._localStream.getTracks().forEach((t) => t.stop());
            this._localStream = null;
        }
        if (this._remoteAudioElement) {
            this._remoteAudioElement.srcObject = null;
        }
        if (this._remoteVideoElement) {
            this._remoteVideoElement.srcObject = null;
            this._remoteVideoElement.style.display = 'none';
        }

        this._activeSession = null;
        this._pendingIncomingSession = null;
        this._videoVisible = false;
        this._isMuted = false;
        this._isVolumeMuted = false;
        this._isConnecting = false;
        this._hasPendingIncomingCall = false;
        this.requestUpdate();
    }

    // ── Call actions ──────────────────────────────────────────────────────

    private async _handleAnswer() {
        if (!this._confbridgeId) {
            this._log('No confbridge ID available', 'error');
            return;
        }
        if (!this._extension) {
            this._log('No extension available', 'error');
            return;
        }

        // Prime audio for autoplay
        if (this._remoteAudioElement) {
            this._remoteAudioElement.play().catch(() => {});
        }

        this._isConnecting = true;
        this._hasPendingIncomingCall = false;
        this.requestUpdate();

        try {
            if (!this._manager.isReady) {
                this._log('Manager not ready, attempting init...', 'warning');
                await this._manager.initialize();
                if (!this._manager.isReady) {
                    throw new Error('Manager still not ready after init');
                }
            }

            if (this._pendingIncomingSession) {
                // Answer the incoming call
                this._log('Answering incoming call');
                this._activeSession = this._pendingIncomingSession;
                this._pendingIncomingSession = null;

                // Attach track handler before answering
                this._activeSession.on('peerconnection', (e: any) => {
                    this._attachTrackHandler(e.peerconnection);
                });

                this._manager.answer(this._activeSession, this._callConfig);
            } else {
                // Place outgoing call
                const callTarget = `sip:${this._extension}@${this._manager.asteriskHost}`;
                this._log(`Making outgoing call to: ${callTarget}`);

                const session = this._manager.call(callTarget, this._callConfig);
                if (!session) {
                    throw new Error('Failed to create call session');
                }

                this._activeSession = session;

                session.on('peerconnection', (e: any) => {
                    this._attachTrackHandler(e.peerconnection);
                });

                // Also try to attach immediately in case peerconnection already exists
                const pc = session.connection;
                if (pc) {
                    this._attachTrackHandler(pc);
                }
            }

            // Accepted → clear connecting flag
            this._activeSession!.on('accepted', () => {
                this._isConnecting = false;
                this.requestUpdate();
            });
            this._activeSession!.on('confirmed', () => {
                if (this._isConnecting) {
                    this._isConnecting = false;
                    this.requestUpdate();
                }
            });

            // Safety timeout
            setTimeout(() => {
                if (this._isConnecting) {
                    this._isConnecting = false;
                    this.requestUpdate();
                }
            }, 10000);

        } catch (error) {
            this._log('Failed to answer call: ' + error, 'error');
            this._isConnecting = false;
            this.requestUpdate();
        }
    }

    private _handleHangup() {
        this._log('Hanging up');
        this._manager.hangup();
        // Session ended/failed events will trigger _cleanupSession
    }

    private async _handleMute() {
        if (!this._activeSession) return;
        try {
            this._isMuted = !this._isMuted;
            if (this._isMuted) {
                await this._activeSession.mute({ audio: true, video: false });
            } else {
                await this._activeSession.unmute({ audio: true, video: false });
            }
            this.requestUpdate();
        } catch (e) {
            this._log('Error toggling mute: ' + e, 'error');
        }
    }

    private _handleVolumeMute() {
        if (!this._remoteAudioElement) return;
        this._isVolumeMuted = !this._isVolumeMuted;
        this._remoteAudioElement.muted = this._isVolumeMuted;
        this.requestUpdate();
    }

    // ── Config & state ────────────────────────────────────────────────────

    setConfig(config: Config) {
        this._config = { ...config };
        this._header = config.header === '' ? nothing : config.header;

        if (!this._config.call_status_entity || !this._config.confbridge_id_entity || !this._config.extension_entity) {
            this._autoDetectSensors();
        }
    }

    private _autoDetectSensors() {
        if (!this.hass) return;
        const newConfig = { ...this._config };

        Object.keys(this.hass.states).forEach((entityId) => {
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

        if (changedProps.has('hass') && this.hass) {
            // Always keep the manager's hass reference current
            this._manager.setHass(this.hass);

            // If the manager never initialized (bootstrap couldn't find
            // hass in time), kick it off now as a fallback
            if (this._manager.status === 'not_initialized') {
                this._manager.initialize(this.hass).catch((e) => {
                    this._log('Fallback manager init failed: ' + e, 'error');
                });
            }

            this._updateState();
        }

        if (
            changedProps.has('_callState') &&
            this._callState === 'inactive' &&
            previousCallState !== 'inactive' &&
            this._activeSession
        ) {
            this._log('Call status changed to inactive, terminating session');
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

    // ── Logging ───────────────────────────────────────────────────────────

    private _log(msg: any, type: string = 'debug') {
        if (!this._config.debug && type === 'debug') return;
        const prefix = `[DOORBELL_CARD][${this._cardId}]`;
        if (type === 'error') console.error(prefix, msg);
        else if (type === 'warning') console.warn(prefix, msg);
        else console.debug(prefix, msg);
    }

    // ── Public diagnostic API (unchanged) ─────────────────────────────────

    private _getLabel(labelState: 'ringing' | 'hangup' | 'inactive'): string {
        const defaults = { ringing: 'Answer', hangup: 'End Live', inactive: 'Idle' };
        return this._config.labels?.[labelState] || defaults[labelState];
    }

    public getSIPStatus(): string {
        return this._sipStatus;
    }

    public getDiagnosticInfo() {
        return {
            cardId: this._cardId,
            managerStatus: this._manager.status,
            managerReady: this._manager.isReady,
            activeSession: !!this._activeSession,
            pendingIncoming: !!this._pendingIncomingSession,
            callState: this._callState,
            confbridgeId: this._confbridgeId,
            extension: this._extension,
            videoVisible: this._videoVisible,
            isMuted: this._isMuted,
            isVolumeMuted: this._isVolumeMuted,
            isConnecting: this._isConnecting,
            hasPendingIncomingCall: this._hasPendingIncomingCall,
        };
    }

    public isReady(): boolean {
        return this._manager.isReady;
    }

    public async manualInitialize(): Promise<boolean> {
        try {
            this._manager.setHass(this.hass);
            await this._manager.initialize();
            return true;
        } catch (e) {
            this._log('Manual initialization failed: ' + e, 'error');
            return false;
        }
    }

    // ── Render (unchanged from original) ──────────────────────────────────

    render() {
        if (!this.hass || !this._config) {
            return html``;
        }

        const hasSession = !!this._activeSession;
        const shouldShowRinging = this._callState === 'ringing' || this._hasPendingIncomingCall;
        const isInCall = (this._callState === 'active' && hasSession) || (hasSession && !this._hasPendingIncomingCall && !this._isConnecting);
        const isLarge = this._config.theme !== 'small';

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
        } else if (shouldShowRinging && !hasSession) {
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
                        <div class="circle-row">
                            <button
                                class="circle-btn ${this._isMuted ? 'toggled' : ''}"
                                ?disabled=${!isInCall}
                                @click=${() => this._handleMute()}
                            >
                                <ha-icon icon="${this._isMuted ? 'mdi:microphone-off' : 'mdi:microphone'}"></ha-icon>
                            </button>

                            <button
                                class="${callBtnClass} circle-btn circle-btn-lg"
                                ?disabled=${callBtnDisabled}
                                @click=${callBtnHandler}
                            >
                                <ha-icon icon="${callBtnIcon}"></ha-icon>
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
                        Manager: ${this._sipStatus} |
                        Session: ${hasSession ? 'Y' : 'N'} |
                        Pending: ${this._hasPendingIncomingCall ? 'Y' : 'N'} |
                        Connecting: ${this._isConnecting ? 'Y' : 'N'}
                    </div>
                    ` : ''}
                </div>
            </ha-card>
        `;
    }

    static getConfigElement() {
        return document.createElement('asterisk-doorbell-editor');
    }

    static getStubConfig() {
        return {
            call_status_entity: '',
            confbridge_id_entity: '',
            extension_entity: '',
            header: '',
            debug: false,
            theme: 'large',
            labels: {
                ringing: 'Answer',
                hangup: 'End Live',
                inactive: 'Idle',
            },
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

                .pill {
                    font-size: 1rem;
                    gap: 0.5rem;
                    padding: 1rem 3rem;
                    border-radius: 0.5rem;
                    background: var(--card-background-color, rgba(255, 255, 255, 0.08));
                }

                .pill ha-icon {
                    --mdc-icon-size: 20px;
                }

                .circle-btn {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: var(--card-background-color, rgba(255, 255, 255, 0.08));
                    padding: 0;
                }

                .circle-btn ha-icon {
                    --mdc-icon-size: 22px;
                }

                .circle-btn-lg {
                    width: 74px;
                    height: 74px;
                }

                .circle-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 3rem;
                }

                .call-btn.inactive {
                    color: var(--secondary-text-color);
                }

                .call-btn.ringing {
                    background: var(--success-color, #4caf50);
                    color: #fff;
                    animation: ring-pulse 1.5s ease-in-out infinite;
                }

                .call-btn.active {
                    background: var(--error-color, #f44336);
                    color: #fff;
                }

                .call-btn.connecting {
                    color: var(--secondary-text-color);
                }

                .circle-btn.toggled {
                    background: var(--error-color, #f44336);
                    color: #fff;
                }

                button:not(:disabled):hover {
                    filter: brightness(1.15);
                }

                button:not(:disabled):active {
                    filter: brightness(0.9);
                }

                @keyframes ring-pulse {
                    0%,
                    100% {
                        box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);
                    }
                    50% {
                        box-shadow: 0 0 0 10px rgba(76, 175, 80, 0);
                    }
                }

                .debug-panel {
                    margin-top: 0.5rem;
                    padding: 0.5rem;
                    background: var(--card-background-color, rgba(0, 0, 0, 0.3));
                    border-radius: 4px;
                    font-size: 0.7rem;
                    color: var(--secondary-text-color);
                    text-align: center;
                    word-break: break-all;
                }
            `,
        ];
    }
}
