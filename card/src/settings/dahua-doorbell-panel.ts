import {html, LitElement} from "lit";
import {property} from "@lit/reactive-element/decorators";
import {HomeAssistant} from "custom-card-helpers";
import {
  mdiDownload
} from "@mdi/js";

export class DahuaDoorbellPanel extends LitElement {
	@property() hass: HomeAssistant;

	settings = (window as any).dahua_doorbell.settings();

	render() {
		return html`
			<ha-top-app-bar-fixed>
				<div slot="title">Dahua Doorbell Settings</div>
				<ha-config-section full-width>
					<dahua-doorbell-ami-config
						.hass="${this.hass}" .settings="${this.settings}"></dahua-doorbell-ami-config>
					<dahua-doorbell-registered-browsers
						.hass="${this.hass}"></dahua-doorbell-registered-browsers>
				</ha-config-section>
				<button>
				  <ha-svg-icon slot="icon" .path=${mdiDownload}></ha-svg-icon>
					Save Changes
				</button>
			</ha-top-app-bar-fixed>
		`
	}
}