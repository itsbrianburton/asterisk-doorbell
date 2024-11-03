/**
 * Dahua Doorbell Registered Browsers Card
 *
 * This card is used within the Dahua Doorbell settings page to assign extensions to browsers.
 */


import {LitElement, html} from "lit";
import {HomeAssistant} from "custom-card-helpers";
import {property} from "@lit/reactive-element/decorators";

export class DahuaDoorbellRegisteredBrowsersCard extends LitElement {
    private _hass: any;

    set hass(hass: HomeAssistant) {
        this._hass = hass;
    }

	browser_toggle(ev: any) {
		console.log(ev.currentTarget);
		const browserId = ev.currentTarget.attributes.browserId.value;
		//const browser = (window as any).dahua_doorbell.browsers[browserId];
		const isRegistered = false;
		this._hass.callWS({
			type: "dahua_doorbell/browser/"+ (isRegistered ? "un" : "") + "register",
			browserId: browserId
		}).then((r) => console.log("Response:", r));
	}

	render() {
		if (!(window as any).browser_mod) {
			return html`
				<ha-card header="Registered Browsers" outlined>
					<div class="card-content">
						<p>Browser Mod not installed or not activated.</p>
					</div>
				</ha-card>`;
		}

		return html`
            <ha-card header="Registered Browsers" outlined>
                <div class="card-content">
                    <p>Below are the browsers registered with browser_mod. Enable the toggle to assign an extension and
					allow those browsers to respond to incoming doorbell calls.</p>
					
                    ${Object.keys((window as any).browser_mod?.browsers).map((d) => {
                        const browser = (window as any).browser_mod.browsers[d];
						const device = {};
						const isRegistered = false;
						const extension = 123;
                        return html`
                            <ha-settings-row>
								<span slot="heading">
								${d}
								</span>
                                <span slot="description">
									Extension: <span>${extension}</span>
								</span>
                                <ha-switch
										browserId=${d} 
                                        .checked=${isRegistered}
                                        @change=${this.browser_toggle}
                                ></ha-switch>
                            </ha-settings-row>`;
                    })}
                </div>
            </ha-card>
		`
	}
}