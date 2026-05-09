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
    private _hass: any = null;
    private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    // How often the heartbeat checks the connection (ms)
    private static readonly HEARTBEAT_MS = 30_000;
    // How long to wait before retrying after a disconnect (ms)
    private static readonly RETRY_MS = 15_000;

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

    // ── Public API ────────────────────────────────────────────────────────

    /**
     * Keep the hass reference current. Cards should call this from
     * their `updated()` lifecycle so the manager always has a fresh
     * reference for WS calls and reconnects.
     */
    setHass(hass: any) {
        this._hass = hass;
    }

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
     * Optionally accepts a hass reference; if omitted, uses the stored one.
     */
    async initialize(hass?: any, settings?: SIPManagerSettings): Promise<void> {
        if (hass) this._hass = hass;

        if (!this._hass) {
            this._log('No hass reference available, cannot initialize', 'error');
            throw new Error('No hass reference');
        }

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

        this._initPromise = this._doInitialize(settings);
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
        this._stopHeartbeat();
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

    private async _doInitialize(settingsOverride?: SIPManagerSettings): Promise<void> {
        this._destroyed = false;
        this._cancelRetry();

        // Resolve settings
        if (settingsOverride) {
            this._settings = settingsOverride;
        } else if (!this._settings) {
            this._settings = await this._fetchSettings();
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
                    this._scheduleRetry();
                })
                .on('connected', () => {
                    this._log('WebSocket connected');
                })
                .on('disconnected', () => {
                    this._log('WebSocket disconnected', 'warning');
                    this._setStatus('disconnected');
                    this._scheduleRetry();
                })
                .on('newRTCSession', (event: RTCSessionEvent) => {
                    this._handleNewRTCSession(event);
                });

            this._ua.start();
            this._startHeartbeat();
            this._log('UA started, heartbeat active');

        } catch (error) {
            this._log('Error creating UA: ' + error, 'error');
            this._ua = null;
            this._setStatus('not_initialized');
            this._scheduleRetry();
            throw error;
        }
    }

    private async _fetchSettings(): Promise<SIPManagerSettings> {
        try {
            const settings = await this._hass.callWS({ type: 'asterisk_doorbell/get_settings' });
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

    private _scheduleRetry() {
        if (this._destroyed) return;
        this._cancelRetry();
        this._log(`Will retry connection in ${SIPManager.RETRY_MS / 1000} seconds`);
        this._retryTimeout = setTimeout(() => {
            this._retryTimeout = null;
            this._initPromise = null; // Allow a fresh init
            this.initialize().catch(() => {});
        }, SIPManager.RETRY_MS);
    }

    private _cancelRetry() {
        if (this._retryTimeout) {
            clearTimeout(this._retryTimeout);
            this._retryTimeout = null;
        }
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────
    // Runs every HEARTBEAT_MS while the manager is active.
    // If the UA has silently died (WebSocket dropped without a
    // 'disconnected' event, or registration lapsed), tear it down
    // and reconnect.

    private _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatInterval = setInterval(() => this._heartbeat(), SIPManager.HEARTBEAT_MS);
    }

    private _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    private _heartbeat() {
        if (this._destroyed) {
            this._stopHeartbeat();
            return;
        }

        // No UA at all — something went very wrong, reconnect
        if (!this._ua) {
            this._log('Heartbeat: no UA, triggering reconnect', 'warning');
            this._scheduleRetry();
            return;
        }

        // UA exists but is not registered — jssip's own re-register
        // timer should handle this, but if the status has been stuck
        // on 'disconnected' or 'not_registered' for a full heartbeat
        // cycle, force a fresh connection.
        if (this._status === 'disconnected' || this._status === 'not_registered') {
            // Only intervene if there isn't already a retry scheduled
            if (!this._retryTimeout && !this._initPromise) {
                this._log('Heartbeat: stuck in ' + this._status + ', forcing reconnect', 'warning');
                this._scheduleRetry();
            }
            return;
        }

        // UA thinks it's registered — verify by checking isRegistered()
        if (!this._ua.isRegistered()) {
            this._log('Heartbeat: UA reports unregistered, triggering re-register', 'warning');
            try {
                this._ua.register();
            } catch (_) {
                this._scheduleRetry();
            }
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
