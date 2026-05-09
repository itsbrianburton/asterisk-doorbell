// @ts-ignore
import { version } from '../package.json';
import { AsteriskDoorbellCard } from './asterisk-doorbell-card';
import { AsteriskDoorbellEditor } from './asterisk-doorbell-editor';
import { SIPManager } from './sip-manager';

declare global {
    interface Window {
        customCards: Array<Object>;
    }
}

function findDoorbellCards(): AsteriskDoorbellCard[] {
    const cards: AsteriskDoorbellCard[] = [];
    document.querySelectorAll('asterisk-doorbell-card').forEach((element) => {
        if (element instanceof AsteriskDoorbellCard) {
            cards.push(element);
        }
    });
    return cards;
}

// Debug helpers now also expose the SIPManager singleton
(window as any).asterisk_debug = {
    getManager: () => SIPManager.getInstance(),

    getManagerStatus: () => {
        const mgr = SIPManager.getInstance();
        return {
            status: mgr.status,
            isReady: mgr.isReady,
            hasActiveSession: mgr.hasActiveSession,
        };
    },

    getCards: () => {
        const cards = findDoorbellCards();
        console.log(`Found ${cards.length} doorbell card(s)`);
        return cards;
    },

    getStatus: () => {
        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found');
            return 'no_cards';
        }
        return cards.map((card, index) => ({
            cardIndex: index,
            status: card.getSIPStatus(),
            diagnostics: card.getDiagnosticInfo(),
        }));
    },

    getDiagnostics: () => {
        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found');
            return {};
        }
        return cards.map((card, index) => ({
            cardIndex: index,
            ...card.getDiagnosticInfo(),
        }));
    },

    isReady: () => {
        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found');
            return false;
        }
        return cards.map((card, index) => ({
            cardIndex: index,
            ready: card.isReady(),
        }));
    },

    reinitialize: async () => {
        const mgr = SIPManager.getInstance();
        console.log('Destroying and reinitializing SIPManager...');
        mgr.destroy();

        const hass = getHass();
        if (!hass) {
            console.error('Cannot reinitialize: hass not available');
            return false;
        }

        try {
            await mgr.initialize(hass);
            console.log('Reinitialization successful');
            return true;
        } catch (e) {
            console.error('Reinitialization failed:', e);
            return false;
        }
    },

    hangup: () => {
        const mgr = SIPManager.getInstance();
        mgr.hangup();
        console.log('Hangup requested');
    },
};

console.info(
    `%c Asterisk Doorbell %c ${version} `,
    'color: white; background: #3498db; font-weight: 700;',
    'color: #3498db; background: white; font-weight: 700;',
);

console.info(
    '%c🔧 Debug Commands Available:',
    'color: #ff6b35; font-weight: bold;',
    '\nasterisk_debug.getManagerStatus() - SIPManager singleton status' +
    '\nasterisk_debug.getCards() - Find all doorbell card instances' +
    '\nasterisk_debug.getStatus() - Get status for all cards' +
    '\nasterisk_debug.getDiagnostics() - Detailed diagnostics' +
    '\nasterisk_debug.isReady() - Check if cards are ready' +
    '\nasterisk_debug.reinitialize() - Destroy and recreate SIP connection' +
    '\nasterisk_debug.hangup() - Hang up active call',
);

// ── Bootstrap: find hass and initialize the SIP manager at load time ──────
// HA stores the hass object on the <home-assistant> root element. It may
// not exist yet when our script runs, so we poll until it appears.

function getHass(): any | null {
    const haRoot = document.querySelector('home-assistant') as any;
    return haRoot?.hass ?? null;
}

function bootstrapManager() {
    const MAX_ATTEMPTS = 60;       // give up after ~30s
    const POLL_INTERVAL_MS = 500;
    let attempts = 0;

    const poll = setInterval(() => {
        attempts++;
        const hass = getHass();

        if (hass) {
            clearInterval(poll);
            const mgr = SIPManager.getInstance();
            console.info('[ASTERISK_DOORBELL] hass found, initializing SIPManager');
            mgr.initialize(hass).catch((e) => {
                console.error('[ASTERISK_DOORBELL] Initial SIPManager init failed:', e);
            });
            return;
        }

        if (attempts >= MAX_ATTEMPTS) {
            clearInterval(poll);
            console.warn('[ASTERISK_DOORBELL] Could not find hass after 30s — SIPManager will init when a card mounts');
        }
    }, POLL_INTERVAL_MS);
}

bootstrapManager();

function registerElements() {
    try {
        if (!customElements.get('asterisk-doorbell-card')) {
            customElements.define('asterisk-doorbell-card', AsteriskDoorbellCard);
        }
    } catch (e) {}
    try {
        if (!customElements.get('asterisk-doorbell-editor')) {
            customElements.define('asterisk-doorbell-editor', AsteriskDoorbellEditor);
        }
    } catch (e) {}
}

registerElements();

let activeRegistry: CustomElementRegistry = window.customElements;
const swapWatcher = setInterval(() => {
    if (window.customElements !== activeRegistry) {
        console.info('[ASTERISK_DOORBELL] customElements registry changed; re-registering');
        activeRegistry = window.customElements;
        registerElements();
    }
}, 250);

setTimeout(() => clearInterval(swapWatcher), 30_000);

window.customCards = window.customCards || [];
window.customCards.push({
    type: 'asterisk-doorbell-card',
    name: 'Asterisk Doorbell Card',
    description: 'Card designed to integrate with video doorbells through an Asterisk server using three global sensors.',
});
