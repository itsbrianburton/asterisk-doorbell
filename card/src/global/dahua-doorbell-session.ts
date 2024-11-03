// @ts-ignore
import {WebSocketInterface, UA} from 'jssip';
import {RTCSessionEvent} from 'jssip/lib/UA';
import {IncomingEvent, OutgoingEvent, RTCSession} from "jssip/lib/RTCSession";

enum DahuaDoorbellSessionStatus {
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
 * This class serves to maintain an open connection to the Asterisk
 * server while Home Assistant is open on the device
 */
export class DahuaDoorbellSession extends EventTarget {
    private _socket: any = null;
    private _session: any = null;
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

    constructor() {
        super();

        // TODO: Do a dependency check for browser_mod and asterisks server

        this.initialize()
            .catch((e) => this._log("Initialization failed", "error"));
    }

    private async _initializeConfig() {
        this._settings = await this._hass.callWS({
            type: "dahua_doorbell/init"
        });


/**
        this._settings = Object.assign({
            ami: window.location.hostname + ':8089/ws',
            host: window.location.hostname,
            browserId: (window as any).browser_mod.browserID
        });
**/
        console.log("[DAHUA_DOORBELL]", this._settings);
    }

    private _browserId() {
        return localStorage['browser_mod-browser-id'] || false;
    }

    private _initializeSocket() {
        if (!this._browserId()) {
            console.error("Browser mod isn't installed.");
            return;
        }

        console.log("Connecting to:", this._settings.ami);

        const ws = new WebSocketInterface(`wss:/${this._settings.host}:${this._settings.port}/ws`);
        this._socket = new UA({
            sockets: [ws],
            uri: `sip:${this._browserId()}@${this._settings.host}`,
            authorization_user: this._browserId(),
            password: this._browserId(),  // TODO: Support custom passwords
            register: true
        });

        this._socket
            .on('registered', () => {
                this._log("Successfully registered client");

                //let session = new RTCSession();
            })
            .on('registrationFailed', () => {
                this._log("Registration failed");
            })
            .on('unregistered', () => {
                this._log("Device unregistered");
            })
            .on('ended', () => {
                this._log("Call ended");
                this.dispatchEvent(new Event('ended'));
            })
            .on('newRTCSession', (event: RTCSessionEvent) => this._newRTCSession(event))
            .on('error', (e) => console.error("Websocket Error:", e));

        this._socket.start();
    }

    private _newRTCSession(event: RTCSessionEvent) {
        this._log(event);

        if (this._session !== null) {
            event.session.terminate();
            return;
        }

        this._session = event.session;

        this._session
            .on('accepted', (event: IncomingEvent | OutgoingEvent) => {
                this._log("Doorbell accepted by", this._settings.browserId);
            });

        if (this._session.direction === 'incoming') {
            this.dispatchEvent(new CustomEvent('incoming_call', {
                detail: {
                    session: this._session,
                    caller: {
                        name: this._session.remote_identity.display_name
                    }
                }
            }));
        }
    }

    /**
     * Function to provide the hass object when available
     */
    async provideHass() {
        await customElements.whenDefined("home-assistant");

        // Prevent infinite loops
        let loop = 0;
        while (!document.querySelector("home-assistant")) {
            await new Promise((r) => window.setTimeout(r, 100));
            /*
            loop += 1;

            if (loop >= 500000) {
                break;
            }

             */
        }

        // TODO: Throw error if node doesn't exist

        const query = document.querySelector("home-assistant");

        if ((query as any).hass) {
            this._hass = (query as any).hass;
            return true;
        }

        return false;
    }

    async initialize() {
        await this.provideHass();

        if (!this._hass) {
            this._log("hass wasn't loaded", "error");
            throw new Error();
        }

        if (!this._browserId()) {
            this._log("browser_mod not loaded", "error");
            throw new Error();
        }

        this._initializeConfig();
        this._initializeSocket();

        this._log("Initialized", this._settings.ami);
    }

    async answer() {
        if (this._session?._status !== DahuaDoorbellSessionStatus.STATUS_WAITING_FOR_ANSWER) {
            this._log("Incorrect call status " + this._session?._status, "error");
        }
        try {
            await this._session.answer(this._callConfig);
        } catch (e) {
            this._log(e, "error");
        }
    }

    async terminate() {
        try {
            await this._socket.terminate();
        } catch (e) {
            this._log("Could not terminate call", "error");
        }
    }

    settings() {
        return this._settings;
    }

    private _log(msg: any, type: string = "debug") {
        const prefix = "[DAHUA_DOORBELL]";

        if (type === "debug" && this._debug) {
            console.debug(prefix, msg);
        } else if (type === "error") {
            console.error(prefix, msg);
        }
    }
}