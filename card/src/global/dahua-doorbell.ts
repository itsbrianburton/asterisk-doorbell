// @ts-ignore
import {version} from '../../package.json';
import { DahuaDoorbellCard } from "./dahua-doorbell-card";
import { DahuaDoorbellSession } from "./dahua-doorbell-session";

// Keep our websocket session open in the background
(window as any).dahua_doorbell = new DahuaDoorbellSession();

declare global {
	interface Window {
		customCards: Array<Object>;
	}
}

console.info(
	`%c Dahua Doorbell %c ${version} `,
	'color: white; background: #91c2ff; font-weight: 700;',
	'color: #91c2ff; background: white; font-weight: 700;',
);

customElements.define("dahua-doorbell-card", DahuaDoorbellCard);

window.customCards = window.customCards || [];
window.customCards.push({
	type: "dahua-doorbell-card",
	name: "Dahua Doorbell Card",
	description: "Card designed to integrate with Dahua video doorbells through an Asterisk server."
});


