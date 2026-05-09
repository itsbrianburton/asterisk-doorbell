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

        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found to trigger reinit');
            return false;
        }

        // Use the first card's hass to reinitialize
        try {
            const success = await cards[0].manualInitialize();
            console.log(`Reinitialization ${success ? 'successful' : 'failed'}`);
            return success;
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
