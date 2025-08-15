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
 * This class maintains a WebRTC connection to Asterisk for actual audio/video communication
 * Works with the new three global sensor architecture
 */
export class AsteriskDoorbellSession extends EventTarget {
    private _socket: UA | null = null;
    private _session: RTCSession | null = null;
    private _hass: any = null;
    private _debug = true;
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
    private _settings: any = {};
    private _localStream: MediaStream | null = null;
    private _remoteAudioElement: HTMLAudioElement | null = null;
    private _remoteVideoElement: HTMLVideoElement | null = null;
    private _initializationAttempted: boolean = false;
    private _entityExtension: string | undefined;

    constructor() {
        super();
        this._initializeWhenReady().then(r => {});
    }

    private async _initializeWhenReady() {
        this._log("Starting initialization...");
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait longer for HA to be ready
        try {
            await this.initialize();
            this._log("Initialization completed successfully");
        } catch (e) {
            this._log("Initialization failed: " + e, "error");
            this._log("Will retry in 10 seconds", "error");
            setTimeout(() => this._initializeWhenReady(), 10000);
        }
    }

    private _autoDetectSensors() {
        if (!this._hass) return;

        // Look for the three global sensors
        Object.keys(this._hass.states).forEach(entityId => {
            if (entityId.includes('asterisk_doorbell_extension')) {
                this._entityExtension = entityId;
            }
        });
    }

    async initialize() {
        if (this._initializationAttempted) {
            this._log("Initialization already attempted, resetting...");
            this._socket = null;
            this._session = null;
        }
        this._initializationAttempted = true;

        this._log("Step 1: Waiting for Home Assistant...");
        const hassReady = await this.provideHass();
        if (!hassReady) {
            this._log("Home Assistant not available after waiting", "error");
            throw new Error("Home Assistant not available");
        }
        this._log("Step 1: ✓ Home Assistant ready");

        try {
            this._log("Step 2: Initializing configuration...");
            await this._initializeConfig();
            this._log("Step 2: ✓ Configuration loaded");
            this._log("Step 2: Settings:", this._settings);

            this._log("Step 3: Initializing media elements...");
            this._initializeMediaElements();
            this._log("Step 3: ✓ Media elements ready");

            this._log("Step 4: Initializing SIP connection...");
            this._initializeSIPConnection();
            this._log("Step 4: ✓ SIP connection initiated");

        } catch (e) {
            this._log("Error during initialization: " + e, "error");
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
        this._remoteVideoElement.style.display = 'none'; // Hidden by default
        document.body.appendChild(this._remoteVideoElement);
    }

    private async _initializeConfig() {
        try {
            this._log("Attempting to get settings from Home Assistant...");
            this._settings = await this._hass.callWS({
                type: "asterisk_doorbell/get_settings"
            });
            this._log("✓ Received settings from HA:", this._settings);

            // Validate settings
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
            this._log("Current settings:", this._settings);
            return;
        }

        // Use Home Assistant proxy instead of direct Asterisk connection
        const haHost = window.location.hostname;
        const haPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
        const haProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const proxyUrl = `${haProtocol}//${haHost}:${haPort}/api/asterisk_doorbell/ws`;

        this._log(`Using HA WebSocket proxy: ${proxyUrl}`);
        this._log(`Proxy will forward to: ws://${this._settings.asterisk_host}:${this._settings.websocket_port}/ws`);

        try {
            const socket = new WebSocketInterface(proxyUrl);

            this._socket = new UA({
                sockets: [socket],
                uri: `sip:homeassistant@${this._settings.asterisk_host}`,
                authorization_user: "homeassistant",
                password: "", // No password needed for homeassistant extension
                register: true,
                register_expires: 300,
                session_timers: false,
                user_agent: 'Asterisk Doorbell HA'
            });

            this._socket
                .on('registered', () => {
                    this._log("✓ SIP client registered successfully via HA proxy");
                    this.dispatchEvent(new CustomEvent('sip_registered'));
                })
                .on('registrationFailed', (e) => {
                    this._log("✗ SIP registration failed: " + JSON.stringify(e), "error");
                })
                .on('newRTCSession', (event: RTCSessionEvent) => this._handleNewRTCSession(event))
                .on('connected', () => {
                    this._log("✓ SIP WebSocket connected via HA proxy to " + proxyUrl);
                })
                .on('disconnected', () => {
                    this._log("✗ SIP WebSocket disconnected from HA proxy", "error");
                });

            this._log("Starting SIP client with HA proxy...");
            this._socket.start();
            this._log("SIP client start() called");

        } catch (error) {
            this._log("Error creating SIP client with HA proxy: " + error, "error");
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
                this.dispatchEvent(new CustomEvent('media_connected'));
            })
            .on('ended', () => {
                this._log("WebRTC session ended");
                this._cleanupSession();
                this.dispatchEvent(new CustomEvent('media_disconnected'));
            })
            .on('failed', (e) => {
                this._log("WebRTC session failed: " + e.cause, "error");
                this._cleanupSession();
            })
            .on('peerconnection', (e) => {
                const peerconnection = e.peerconnection;

                // Handle remote media streams
                peerconnection.ontrack = (event) => {
                    if (event.streams && event.streams[0]) {
                        const stream = event.streams[0];
                        const videoTracks = stream.getVideoTracks();
                        const audioTracks = stream.getAudioTracks();

                        if (videoTracks.length > 0 && this._remoteVideoElement) {
                            this._remoteVideoElement.srcObject = stream;
                            this._log("Video stream connected");
                            this.dispatchEvent(new CustomEvent('video_stream_ready', {
                                detail: { videoElement: this._remoteVideoElement }
                            }));
                        }

                        if (audioTracks.length > 0 && this._remoteAudioElement) {
                            this._remoteAudioElement.srcObject = stream;
                            this._log("Audio stream connected");
                        }
                    }
                };

                // Get local stream for mute controls
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
    }

    /**
     * Answer a doorbell call by calling the admin extension for the given confbridge
     */
    async answerCall(confbridgeId: string) {
        this._log(`Answer call requested for confbridge: ${confbridgeId}`);

        // Check SIP client status
        if (!this._socket) {
            this._log("SIP client not available", "error");
            this._log("Diagnostic info:", this.getDiagnosticInfo());
            return false;
        }

        // Check if SIP client is registered
        if (!this._socket.isRegistered()) {
            this._log("SIP client not registered", "error");
            this._log("Diagnostic info:", this.getDiagnosticInfo());
            return false;
        }

        try {
            // Get the admin extension for this confbridge
            const adminExtension = this._getAdminExtensionForConfbridge();

            // Make SIP call to the admin extension - this triggers doorbell-admin macro
            const callTarget = `sip:${adminExtension}@${this._settings.asterisk_host}`;

            this._log(`Answering call by calling admin extension: ${callTarget}`);

            this._session = this._socket.call(callTarget, this._callConfig);

            // Asterisk will automatically:
            // 1. Execute doorbell-admin macro
            // 2. Join homeassistant to confbridge as admin
            // 3. Send "answered" webhook to HA
            // 4. Establish WebRTC audio/video between browser and doorbell

            return true;

        } catch (e) {
            this._log("Error answering call: " + e, "error");
            return false;
        }
    }

    /**
     * Hang up the current call
     */
    async hangupCall() {
        if (this._session) {
            try {
                this._session.terminate();

                // Asterisk will automatically:
                // 1. Clean up the confbridge when admin leaves
                // 2. Send "terminate" webhook to HA
                // 3. Update sensor states

                return true;
            } catch (e) {
                this._log("Error hanging up call: " + e, "error");
                return false;
            }
        }
        return false;
    }

    /**
     * Toggle microphone mute
     */
    async toggleMute(mute: boolean) {
        if (!this._session) {
            this._log("No active session to mute", "error");
            return false;
        }

        try {
            if (mute) {
                await this._session.mute({ audio: true, video: false });
            } else {
                await this._session.unmute({ audio: true, video: false });
            }
            return true;
        } catch (e) {
            this._log("Error toggling mute: " + e, "error");
            return false;
        }
    }

    /**
     * Get the video element for display in UI
     */
    getVideoElement(): HTMLVideoElement | null {
        return this._remoteVideoElement;
    }

    /**
     * Show/hide the video element
     */
    setVideoVisible(visible: boolean) {
        if (this._remoteVideoElement) {
            this._remoteVideoElement.style.display = visible ? 'block' : 'none';
        }
    }

    /**
     * Map confbridge ID to admin extension based on your numbering scheme
     * This needs to match your extensions.conf configuration
     */
    private _getAdminExtensionForConfbridge(): string {
        if (this._hass && this._entityExtension) {
            if (this._hass.states[this._entityExtension]) {
                this._log("State:", this._hass.states[this._entityExtension]);
                return this._hass.states[this._entityExtension].state;
            }
        }

        return '';
    }

    /**
     * Get diagnostic information about the session state
     */
    getDiagnosticInfo() {
        return {
            socketExists: !!this._socket,
            socketStatus: this._socket ? (this._socket.isRegistered() ? 'registered' : 'not registered') : 'null',
            sessionExists: !!this._session,
            settings: this._settings,
            hassConnected: !!this._hass,
            initializationAttempted: this._initializationAttempted,
        };
    }

    /**
     * Manually trigger initialization (for debugging)
     */
    async manualInitialize() {
        this._log("Manual initialization triggered");
        try {
            await this.initialize();
            this._log("Manual initialization successful");
            return true;
        } catch (e) {
            this._log("Manual initialization failed: " + e, "error");
            return false;
        }
    }

    async provideHass() {
        await customElements.whenDefined("home-assistant");
        let attempts = 0;
        const maxAttempts = 100; // Increase attempts

        while (attempts < maxAttempts) {
            const query = document.querySelector("home-assistant");
            if (query && (query as any).hass) {
                this._hass = (query as any).hass;
                this._log(`Found Home Assistant after ${attempts} attempts`);

                this._autoDetectSensors();

                return true;
            }
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }
        this._log(`Failed to find Home Assistant after ${maxAttempts} attempts`, "error");
        return false;
    }

    /**
     * Check if the session is ready to make calls
     */
    isReady(): boolean {
        return !!(this._socket && this._socket.isRegistered());
    }

    /**
     * Get current connection status
     */
    getStatus(): string {
        if (!this._socket) return 'not_initialized';
        if (!this._socket.isRegistered()) return 'not_registered';
        return 'ready';
    }

    private _log(msg: any, type: string | object = "debug") {
        const prefix = "[ASTERISK_DOORBELL_SESSION]";
        if (type === "debug" && this._debug) {
            console.debug(prefix, msg);
        } else if (type === "error") {
            console.error(prefix, msg);
        } else if (type === "warning") {
            console.warn(prefix, msg);
        }
    }
}