// @ts-ignore
import { version } from '../package.json';
import { AsteriskDoorbellCard } from "./asterisk-doorbell-card";
import { AsteriskDoorbellEditor } from "./asterisk-doorbell-editor";
import { AsteriskDoorbellSession } from "./asterisk-doorbell-session";

// Initialize the session globally for the three global sensors architecture
(window as any).asterisk_doorbell = new AsteriskDoorbellSession();

// Declare global types
declare global {
    interface Window {
        customCards: Array<Object>;
    }
}

// Log version information
console.info(
    `%c Asterisk Doorbell %c ${version} `,
    'color: white; background: #3498db; font-weight: 700;',
    'color: #3498db; background: white; font-weight: 700;',
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