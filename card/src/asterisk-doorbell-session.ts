// @ts-ignore
import { UA, WebSocketInterface } from 'jssip';
import { RTCSessionEvent } from 'jssip/lib/UA';
import { IncomingEvent, OutgoingEvent, RTCSession } from "jssip/lib/RTCSession";

enum SessionStatus {
    STATUS_NULL = 0,
    STATUS_INVITE_SENT = 1,
    STATUS_1XX_RECEIVED = 2,
    STATUS_INVITE_RECEIVED = 3,
    STATUS_WAITING_FOR_ANSWER = 4,
    STATUS_ANSWERED = 5,
    STATUS_WAITING_FOR_ACK = 6,
    STATUS_CANCELED = 7,
    STATUS_TERMINATED = 8,
    STATUS_CONFIRMED = 9
}

/**
 * This class maintains an open connection to the Asterisk server
 * and handles call management for the Asterisk Doorbell integration.
 */
export class AsteriskDoorbellSession extends EventTarget {
    private _socket: UA | null = null;
    private _session: RTCSession | null = null;
    private _sessionStatus: string = 'idle';
    private _hass: any = null;
    private _debug = true;
    private _callConfig: any = {
        mediaConstraints: {
            audio: true,
            video: false
        },
        rtcOfferConstraints: {
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        }
    };
    private _settings: any = {};
    private _registeredExtension: string = '';
    private _activeBridgeId: string = '';
    private _localStream: MediaStream | null = null;
    private _audioElement: HTMLAudioElement | null = null;

    constructor() {
        super();

        // Don't initialize immediately, wait for proper timing
        this._initializeWhenReady();
    }

    /**
     * Initialize when Home Assistant is ready
     */
    private async _initializeWhenReady() {
        // Wait a bit for the DOM to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            await this.initialize();
        } catch (e) {
            this._log("Initialization failed, will retry in 5 seconds", "error");
            // Retry after 5 seconds
            setTimeout(() => this._initializeWhenReady(), 5000);
        }
    }

    /**
     * Initialize the session and settings
     */
    async initialize() {
        const hassReady = await this.provideHass();

        if (!hassReady) {
            this._log("Home Assistant wasn't loaded", "error");
            throw new Error("Home Assistant not available");
        }

        if (!this._browserId()) {
            this._log("browser_mod not loaded - this is optional for basic functionality", "debug");
            // Don't throw an error here, as browser_mod might not be required
        }

        try {
            await this._initializeConfig();
            this._initializeAudio();
            // Only initialize SIP if we have proper credentials
            if (this._settings.username && this._settings.password) {
                this._initializeSIPConnection();
            } else {
                this._log("No SIP credentials available, SIP connection disabled", "debug");
            }

            this._log("Initialized with ARI server:", this._settings.host);
        } catch (e) {
            this._log("Error during initialization: " + e, "error");
            throw e;
        }
    }

    /**
     * Initialize audio element for remote audio
     */
    private _initializeAudio() {
        this._audioElement = document.createElement('audio');
        this._audioElement.autoplay = true;
        document.body.appendChild(this._audioElement);
    }

    /**
     * Fetch configuration from Home Assistant
     */
    private async _initializeConfig() {
        try {
            // Try to get config from Home Assistant
            this._settings = await this._hass.callWS({
                type: "asterisk_doorbell/get_settings"
            });

            this._log("Received settings from Home Assistant", this._settings);
        } catch (e) {
            this._log("Failed to get settings from Home Assistant: " + e, "error");
            this._log("Using default settings", "debug");

            // Fallback to default settings
            this._settings = {
                host: window.location.hostname,
                port: 8088,
                websocket_port: 8089,
                username: this._browserId() || 'guest',
                password: this._browserId() || 'guest',
                pjsip_domain: window.location.hostname,
                bridges: []
            };
        }
    }

    /**
     * Get browser ID for SIP registration
     */
    private _browserId() {
        return localStorage['browser_mod-browser-id'] || false;
    }

    /**
     * Initialize SIP connection to Asterisk
     */
    private _initializeSIPConnection() {
        const browserId = this._browserId();
        if (!browserId) {
            this._log("No browser ID available", "error");
            return;
        }

        // Check if we have the required settings
        if (!this._settings.host || !this._settings.websocket_port) {
            this._log("Missing required SIP settings, skipping SIP connection", "debug");
            return;
        }

        // Configure WebSocket for SIP
        const socketUrl = `wss://${this._settings.host}:${this._settings.websocket_port}/ws`;
        this._log(`Attempting to connect to SIP WebSocket: ${socketUrl}`);

        const socket = new WebSocketInterface(socketUrl);

        // Create SIP User Agent
        this._socket = new UA({
            sockets: [socket],
            uri: `sip:${browserId}@${this._settings.pjsip_domain}`,
            authorization_user: browserId,
            password: browserId,
            register: true,
            register_expires: 300,
            session_timers: false,
            user_agent: 'Asterisk Doorbell HA'
        });

        // Set up event handlers
        this._socket
            .on('registered', () => {
                this._log("Successfully registered with Asterisk SIP server");
                this._registeredExtension = browserId;
                this.dispatchEvent(new CustomEvent('registered', {
                    detail: { extension: browserId }
                }));
            })
            .on('registrationFailed', (e) => {
                this._log("SIP registration failed: " + JSON.stringify(e), "error");
                this.dispatchEvent(new Event('registration_failed'));
            })
            .on('unregistered', () => {
                this._log("SIP client unregistered");
                this.dispatchEvent(new Event('unregistered'));
            })
            .on('newRTCSession', (event: RTCSessionEvent) => this._handleNewRTCSession(event))
            .on('connected', () => {
                this._log("SIP WebSocket connected");
            })
            .on('disconnected', () => {
                this._log("SIP WebSocket disconnected", "error");
                // Don't auto-reconnect for now to avoid spam
                this._log("SIP auto-reconnect disabled. Manual reconnection required.", "debug");
            })
            .on('error', (e) => {
                this._log("SIP error: " + e.message, "error");
            });

        // Start the SIP stack
        try {
            this._socket.start();
        } catch (e) {
            this._log("Failed to start SIP client: " + e, "error");
        }
    }

    /**
     * Handle a new RTC session (incoming or outgoing call)
     */
    private _handleNewRTCSession(event: RTCSessionEvent) {
        this._log("New RTC session", "debug");

        // If we already have a session, terminate the new one
        if (this._session) {
            this._log("Already have active session, terminating new one", "debug");
            event.session.terminate();
            return;
        }

        this._session = event.session;

        // Set up session event handlers
        this._session
            .on('accepted', (e: IncomingEvent | OutgoingEvent) => {
                this._log("Call accepted");
                this._sessionStatus = 'active';
                this.dispatchEvent(new Event('call_accepted'));
            })
            .on('confirmed', () => {
                this._log("Call confirmed");
            })
            .on('ended', () => {
                this._log("Call ended");
                this._cleanupSession();
                this.dispatchEvent(new Event('call_ended'));
            })
            .on('failed', (e) => {
                this._log("Call failed: " + e.cause, "error");
                this._cleanupSession();
                this.dispatchEvent(new CustomEvent('call_failed', {
                    detail: { cause: e.cause }
                }));
            })
            .on('muted', (data) => {
                this._log("Call muted: " + JSON.stringify(data));
                this.dispatchEvent(new CustomEvent('call_muted', {
                    detail: { audio: data.audio, video: data.video }
                }));
            })
            .on('unmuted', (data) => {
                this._log("Call unmuted: " + JSON.stringify(data));
                this.dispatchEvent(new CustomEvent('call_unmuted', {
                    detail: { audio: data.audio, video: data.video }
                }));
            })
            .on('peerconnection', (e) => {
                const peerconnection = e.peerconnection;

                // Handle remote streams
                peerconnection.ontrack = (event) => {
                    if (event.streams && event.streams[0]) {
                        this._log("Received remote media stream");
                        if (this._audioElement) {
                            this._audioElement.srcObject = event.streams[0];
                        }
                    }
                };

                // Store local stream for mute controls
                if (e.stream) {
                    this._localStream = e.stream;
                }
            });

        // If it's an incoming call
        if (this._session.direction === 'incoming') {
            this._log("Incoming call from: " + this._session.remote_identity.uri.user);
            this._sessionStatus = 'ringing';

            // Notify the UI of the incoming call
            this.dispatchEvent(new CustomEvent('incoming_call', {
                detail: {
                    session: this._session,
                    caller: {
                        name: this._session.remote_identity.display_name || this._session.remote_identity.uri.user,
                        extension: this._session.remote_identity.uri.user
                    }
                }
            }));
        }
    }

    /**
     * Clean up after a call ends
     */
    private _cleanupSession() {
        if (this._localStream) {
            this._localStream.getTracks().forEach(track => track.stop());
            this._localStream = null;
        }

        if (this._audioElement) {
            this._audioElement.srcObject = null;
        }

        this._session = null;
        this._sessionStatus = 'idle';
        this._activeBridgeId = '';
    }

    /**
     * Get Home Assistant instance when available
     */
    async provideHass() {
        // Wait for custom elements to be defined
        await customElements.whenDefined("home-assistant");

        // Wait for home-assistant element to be available with more retries
        let attempts = 0;
        const maxAttempts = 100; // Increase max attempts

        while (attempts < maxAttempts) {
            const query = document.querySelector("home-assistant");

            if (query && (query as any).hass) {
                this._hass = (query as any).hass;
                this._log("Successfully connected to Home Assistant");
                return true;
            }

            // Wait longer between attempts
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }

        this._log(`Failed to connect to Home Assistant after ${maxAttempts} attempts`, "error");
        return false;
    }

    /**
     * Answer an incoming call and connect to the specified bridge
     */
    async answer(bridgeId: string, extension: string) {
        this._log(`Answering call to join bridge ${bridgeId} with extension ${extension}`);

        if (!this._socket) {
            this._log("SIP client not initialized", "error");
            return;
        }

        try {
            // If we have an incoming call, answer it
            if (this._session && this._session.direction === 'incoming' &&
                this._session._status === SessionStatus.STATUS_WAITING_FOR_ANSWER) {

                this._log("Answering incoming call");
                this._activeBridgeId = bridgeId;
                await this._session.answer(this._callConfig);
            } else {
                // Otherwise, make an outgoing call to join the bridge
                this._log("Making outgoing call to join bridge");

                // Use the Home Assistant service to dial into the bridge
                await this._hass.callService('asterisk_doorbell', 'dial_into_bridge', {
                    bridge_id: bridgeId,
                    endpoint: `SIP/${extension}`
                });

                this._activeBridgeId = bridgeId;
            }
        } catch (e) {
            this._log("Error answering call: " + e, "error");
        }
    }

    /**
     * Toggle microphone mute state
     */
    async toggleMute(mute: boolean) {
        if (!this._session || this._sessionStatus !== 'active') {
            this._log("No active call to mute", "error");
            return;
        }

        try {
            if (mute) {
                await this._session.mute({ audio: true, video: false });
                this._log("Microphone muted");
            } else {
                await this._session.unmute({ audio: true, video: false });
                this._log("Microphone unmuted");
            }
        } catch (e) {
            this._log("Error toggling mute: " + e, "error");
        }
    }

    /**
     * Terminate the active call
     */
    async terminate(bridgeId: string) {
        this._log("Terminating call");

        if (!this._socket) {
            this._log("SIP client not initialized", "error");
            return;
        }

        try {
            // If we have an active session, terminate it
            if (this._session) {
                await this._session.terminate();
            }

            // Also call the Home Assistant service to clean up
            if (bridgeId) {
                await this._hass.callService('asterisk_doorbell', 'terminate', {
                    confbridge: bridgeId
                });
            }
        } catch (e) {
            this._log("Error terminating call: " + e, "error");
        }
    }

    /**
     * Logger function
     */
    private _log(msg: any, type: string = "debug") {
        const prefix = "[ASTERISK_DOORBELL]";

        if (type === "debug" && this._debug) {
            console.debug(prefix, msg);
        } else if (type === "error") {
            console.error(prefix, msg);
        }
    }
}