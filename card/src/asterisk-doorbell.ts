// @ts-ignore
import { version } from '../package.json';
import { AsteriskDoorbellCard } from "./asterisk-doorbell-card";
import { AsteriskDoorbellEditor } from "./asterisk-doorbell-editor";
import { AsteriskDoorbellSession } from "./asterisk-doorbell-session";

// Initialize the session globally for the three global sensors architecture
(window as any).asterisk_doorbell = new AsteriskDoorbellSession();

// Add debugging helpers to window for console access
(window as any).asterisk_debug = {
    getStatus: () => (window as any).asterisk_doorbell.getStatus(),
    getDiagnostics: () => (window as any).asterisk_doorbell.getDiagnosticInfo(),
    isReady: () => (window as any).asterisk_doorbell.isReady(),
    reinitialize: () => (window as any).asterisk_doorbell.manualInitialize(),
};

// Declare global types
declare global {
    interface Window {
        customCards: Array<Object>;
    }
}

// Log version information and debugging info
console.info(
    `%c Asterisk Doorbell %c ${version} `,
    'color: white; background: #3498db; font-weight: 700;',
    'color: #3498db; background: white; font-weight: 700;',
);

console.info(
    '%c🔧 Debug Commands Available:',
    'color: #ff6b35; font-weight: bold;',
    '\nasterisk_debug.getStatus() - Get connection status\nasterisk_debug.getDiagnostics() - Get detailed diagnostics\nasterisk_debug.isReady() - Check if ready to make calls\nasterisk_debug.reinitialize() - Manually reinitialize SIP client'
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