// @ts-ignore
import { version } from '../package.json';
import { AsteriskDoorbellCard } from "./asterisk-doorbell-card";
import { AsteriskDoorbellEditor } from "./asterisk-doorbell-editor";

// Declare global types
declare global {
    interface Window {
        customCards: Array<Object>;
    }
}

// Helper function to find card instances
function findDoorbellCards(): AsteriskDoorbellCard[] {
    const cards: AsteriskDoorbellCard[] = [];
    document.querySelectorAll('asterisk-doorbell-card').forEach(element => {
        if (element instanceof AsteriskDoorbellCard) {
            cards.push(element);
        }
    });
    return cards;
}

// Add debugging helpers to window for console access
(window as any).asterisk_debug = {
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
            diagnostics: card.getDiagnosticInfo()
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
            ...card.getDiagnosticInfo()
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
            ready: card.isReady()
        }));
    },

    reinitialize: async () => {
        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found');
            return false;
        }

        console.log(`Reinitializing ${cards.length} doorbell card(s)...`);

        const results = await Promise.all(
            cards.map(async (card, index) => {
                try {
                    const success = await card.manualInitialize();
                    console.log(`Card ${index}: Reinitialization ${success ? 'successful' : 'failed'}`);
                    return { cardIndex: index, success };
                } catch (e) {
                    console.error(`Card ${index}: Reinitialization failed:`, e);
                    return { cardIndex: index, success: false, error: e };
                }
            })
        );

        return results;
    },

    testCall: async (cardIndex: number = 0) => {
        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found');
            return false;
        }

        if (cardIndex >= cards.length) {
            console.error(`Card index ${cardIndex} not found. Available cards: 0-${cards.length - 1}`);
            return false;
        }

        const card = cards[cardIndex];
        const diagnostics = card.getDiagnosticInfo();

        if (!diagnostics.confbridgeId) {
            console.error('No confbridge ID available for test call');
            return false;
        }

        console.log(`Testing call on card ${cardIndex} with confbridge: ${diagnostics.confbridgeId}`);
        return await (card as any)._handleAnswer();
    },

    hangupAll: async () => {
        const cards = findDoorbellCards();
        if (cards.length === 0) {
            console.warn('No doorbell cards found');
            return false;
        }

        console.log(`Hanging up all active calls on ${cards.length} card(s)...`);

        const results = await Promise.all(
            cards.map(async (card, index) => {
                try {
                    const diagnostics = card.getDiagnosticInfo();
                    if (diagnostics.sessionExists) {
                        await (card as any)._handleHangup();
                        console.log(`Card ${index}: Hangup successful`);
                        return { cardIndex: index, success: true };
                    } else {
                        console.log(`Card ${index}: No active session to hang up`);
                        return { cardIndex: index, success: true, note: 'no_active_session' };
                    }
                } catch (e) {
                    console.error(`Card ${index}: Hangup failed:`, e);
                    return { cardIndex: index, success: false, error: e };
                }
            })
        );

        return results;
    }
};

// Log version information and debugging info
console.info(
    `%c Asterisk Doorbell %c ${version} `,
    'color: white; background: #3498db; font-weight: 700;',
    'color: #3498db; background: white; font-weight: 700;',
);

console.info(
    '%c🔧 Debug Commands Available:',
    'color: #ff6b35; font-weight: bold;',
    '\nasterisk_debug.getCards() - Find all doorbell card instances' +
    '\nasterisk_debug.getStatus() - Get connection status for all cards' +
    '\nasterisk_debug.getDiagnostics() - Get detailed diagnostics for all cards' +
    '\nasterisk_debug.isReady() - Check if cards are ready to make calls' +
    '\nasterisk_debug.reinitialize() - Manually reinitialize SIP clients' +
    '\nasterisk_debug.testCall(cardIndex) - Test call on specific card' +
    '\nasterisk_debug.hangupAll() - Hang up all active calls'
);

// Register the custom card
if (!customElements.get("asterisk-doorbell-card")) {
    customElements.define("asterisk-doorbell-card", AsteriskDoorbellCard);
}

// Register the editor
if (!customElements.get("asterisk-doorbell-editor")) {
    customElements.define("asterisk-doorbell-editor", AsteriskDoorbellEditor);
}

// Add to customCards array for the UI
window.customCards = window.customCards || [];
window.customCards.push({
    type: "asterisk-doorbell-card",
    name: "Asterisk Doorbell Card",
    description: "Card designed to integrate with video doorbells through an Asterisk server using three global sensors."
});