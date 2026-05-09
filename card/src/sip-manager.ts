import { UA, WebSocketInterface } from 'jssip';
import { RTCSessionEvent } from 'jssip/lib/UA';
import { RTCSession } from 'jssip/lib/RTCSession';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SIPStatus = 'not_initialized' | 'connecting' | 'registered' | 'not_registered' | 'disconnected';

export type SIPManagerEvent =
    | { type: 'status_changed'; status: SIPStatus }
    | { type: 'incoming_call'; session: RTCSession }
    | { type: 'session_ended' }
    | { type: 'session_failed'; cause: string }
    | { type: 'log'; message: string; level: 'debug' | 'warning' | 'error' };

export type SIPManagerListener = (event: SIPManagerEvent) => void;

export interface SIPManagerSettings {
    asterisk_host: string;
    websocket_port: number;
}

// ─── Singleton SIP Manager ────────────────────────────────────────────────────

const MANAGER_KEY = '__asterisk_doorbell_sip_manager__';

export class SIPManager {
    private _ua: UA | null = null;
    private _session: RTCSession | null = null;
    private _status: SIPStatus = 'not_initialized';
    private _listeners: Set<SIPManagerListener> = new Set();
    private _settings: SIPManagerSettings | null = null;
    private _retryTimeout: ReturnType<typeof setTimeout> | null = null;
    private _initPromise: Promise<void> | null = null;
    private _destroyed: boolean = false;

    // ── Singleton access ──────────────────────────────────────────────────

    static getInstance(): SIPManager {
        const win = window as any;
        if (!win[MANAGER_KEY]) {
            win[MANAGER_KEY] = new SIPManager();
        }
        return win[MANAGER_KEY];
    }

    private constructor() {
        this._log('SIPManager singleton created');
    }

    // ── Public API for cards ──────────────────────────────────────────────

    /**
     * Subscribe to manager events. Returns an unsubscribe function.
     */
    subscribe(listener: SIPManagerListener): () => void {
        this._listeners.add(listener);
        // Immediately notify the new subscriber of current status
        listener({ type: 'status_changed', status: this._status });
        return () => this._listeners.delete(listener);
    }

    /**
     * Initialize the SIP connection. Safe to call multiple times —
     * subsequent calls are no-ops if already initialized or in progress.
     */
    async initialize(hass: any, settings?: SIPManagerSettings): Promise<void> {
        // If already running and registered, nothing to do
        if (this._ua && this._status === 'registered') {
            this._log('Already registered, skipping init');
            return;
        }

        // If an init is already in flight, wait for it
        if (this._initPromise) {
            this._log('Init already in progress, waiting...');
            return this._initPromise;
        }

        this._initPromise = this._doInitialize(hass, settings);
        try {
            await this._initPromise;
        } finally {
            this._initPromise = null;
        }
    }

    /**
     * Current connection status.
     */
    get status(): SIPStatus {
        return this._status;
    }

    /**
     * Whether the manager has an active (non-pending) session.
     */
    get hasActiveSession(): boolean {
        return !!this._session;
    }

    /**
     * The current RTCSession, if any.
     */
    get session(): RTCSession | null {
        return this._session;
    }

    /**
     * Whether the UA is registered and ready to place/receive calls.
     */
    get isReady(): boolean {
        return this._status === 'registered';
    }

    /**
     * Place an outgoing call. Returns the RTCSession.
     */
    call(target: string, options: any): RTCSession | null {
        if (!this._ua || !this._ua.isRegistered()) {
            this._log('Cannot call: UA not registered', 'error');
            return null;
        }

        if (this._session) {
            this._log('Cannot call: session already active', 'error');
            return null;
        }

        const session = this._ua.call(target, options);
        this._session = session;
        this._setupSessionHandlers(session);
        return session;
    }

    /**
     * Answer an incoming call that was delivered via the incoming_call event.
     */
    answer(session: RTCSession, options: any): void {
        if (this._session && this._session !== session) {
            this._log('Another session is already active, terminating it first', 'warning');
            try { this._session.terminate(); } catch (_) {}
        }
        this._session = session;
        session.answer(options);
    }

    /**
     * Hang up the current session.
     */
    hangup(): void {
        if (this._session) {
            try { this._session.terminate(); } catch (_) {}
            this._session = null;
        }
    }

    /**
     * Fully tear down the UA. Useful if settings change and
     * you need to reconnect with new parameters.
     */
    destroy(): void {
        this._destroyed = true;
        this._cancelRetry();
        this._destroyUA();
        this._setStatus('not_initialized');
        this._log('SIPManager destroyed');
    }

    /**
     * Get the Asterisk host for building SIP URIs.
     */
    get asteriskHost(): string {
        return this._settings?.asterisk_host || '';
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private async _doInitialize(hass: any, settingsOverride?: SIPManagerSettings): Promise<void> {
        this._destroyed = false;
        this._cancelRetry();

        // Resolve settings
        if (settingsOverride) {
            this._settings = settingsOverride;
        } else if (!this._settings) {
            this._settings = await this._fetchSettings(hass);
        }

        if (!this._settings.asterisk_host || !this._settings.websocket_port) {
            this._log('Invalid SIP settings', 'error');
            throw new Error('Invalid SIP settings');
        }

        // Tear down any existing UA before creating a new one
        this._destroyUA();

        this._setStatus('connecting');

        const haHost = window.location.hostname;
        const haPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
        const haProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const proxyUrl = `${haProtocol}//${haHost}:${haPort}/api/asterisk_doorbell/ws`;

        this._log(`Connecting via HA WebSocket proxy: ${proxyUrl}`);

        try {
            const socket = new WebSocketInterface(proxyUrl);

            this._ua = new UA({
                sockets: [socket],
                uri: `sip:homeassistant@${this._settings.asterisk_host}`,
                authorization_user: 'homeassistant',
                password: '',
                register: true,
                register_expires: 120,
                session_timers: false,
                user_agent: 'Asterisk Doorbell HA (SIPManager)',
            });

            this._ua
                .on('registered', () => {
                    this._log('SIP registered');
                    this._setStatus('registered');
                })
                .on('registrationFailed', (e) => {
                    this._log('SIP registration failed: ' + JSON.stringify(e), 'error');
                    this._setStatus('not_registered');
                    this._scheduleRetry(hass);
                })
                .on('connected', () => {
                    this._log('WebSocket connected');
                })
                .on('disconnected', () => {
                    this._log('WebSocket disconnected', 'warning');
                    this._setStatus('disconnected');
                    this._scheduleRetry(hass);
                })
                .on('newRTCSession', (event: RTCSessionEvent) => {
                    this._handleNewRTCSession(event);
                });

            this._ua.start();
            this._log('UA started');

        } catch (error) {
            this._log('Error creating UA: ' + error, 'error');
            this._ua = null;
            this._setStatus('not_initialized');
            this._scheduleRetry(hass);
            throw error;
        }
    }

    private async _fetchSettings(hass: any): Promise<SIPManagerSettings> {
        try {
            const settings = await hass.callWS({ type: 'asterisk_doorbell/get_settings' });
            if (settings?.asterisk_host && settings?.websocket_port) {
                return settings;
            }
            throw new Error('Invalid settings from HA');
        } catch (e) {
            this._log('Failed to get settings from HA, using fallback: ' + e, 'warning');
            return {
                asterisk_host: window.location.hostname,
                websocket_port: 8089,
            };
        }
    }

    private _handleNewRTCSession(event: RTCSessionEvent) {
        const session = event.session;

        if (session.direction === 'incoming') {
            this._log('Incoming call received');

            // If we already have an active session, reject the new one
            if (this._session) {
                this._log('Already in a session, rejecting incoming call');
                session.terminate();
                return;
            }

            // Set up handlers so ended/failed events clean up properly
            this._setupSessionHandlers(session);

            // Notify all subscribed cards — one of them will answer
            this._emit({ type: 'incoming_call', session });

        } else {
            // Outgoing sessions are set up in call(), nothing extra needed here
        }
    }

    private _setupSessionHandlers(session: RTCSession) {
        session
            .on('ended', () => {
                this._log('Session ended');
                this._session = null;
                this._emit({ type: 'session_ended' });
            })
            .on('failed', (e) => {
                this._log('Session failed: ' + e.cause, 'error');
                this._session = null;
                this._emit({ type: 'session_failed', cause: e.cause });
            });
    }

    private _destroyUA() {
        if (this._session) {
            try { this._session.terminate(); } catch (_) {}
            this._session = null;
        }
        if (this._ua) {
            try {
                this._ua.unregister({ all: true });
                this._ua.stop();
            } catch (_) {}
            this._ua = null;
        }
    }

    private _scheduleRetry(hass: any) {
        if (this._destroyed) return;
        this._cancelRetry();
        this._log('Will retry connection in 15 seconds');
        this._retryTimeout = setTimeout(() => {
            this._retryTimeout = null;
            this._initPromise = null; // Allow a fresh init
            this.initialize(hass).catch(() => {});
        }, 15000);
    }

    private _cancelRetry() {
        if (this._retryTimeout) {
            clearTimeout(this._retryTimeout);
            this._retryTimeout = null;
        }
    }

    private _setStatus(status: SIPStatus) {
        if (this._status !== status) {
            this._status = status;
            this._emit({ type: 'status_changed', status });
        }
    }

    private _emit(event: SIPManagerEvent) {
        this._listeners.forEach((listener) => {
            try {
                listener(event);
            } catch (e) {
                console.error('[SIPManager] Listener error:', e);
            }
        });
    }

    private _log(msg: string, level: 'debug' | 'warning' | 'error' = 'debug') {
        const prefix = '[SIPManager]';
        if (level === 'error') console.error(prefix, msg);
        else if (level === 'warning') console.warn(prefix, msg);
        else console.debug(prefix, msg);

        this._emit({ type: 'log', message: msg, level });
    }
}
