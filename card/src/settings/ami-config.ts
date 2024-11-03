/**
 * Dahua Doorbell AMI Configuration Card
 *
 * Used within the Dahua Doorbell Settings panel to configure the AMI credentials.
 */

import {LitElement, html} from "lit";
import {HomeAssistant} from "custom-card-helpers";
import {property} from "@lit/reactive-element/decorators";

export class DahuaDoorbellAmiConfigCard extends LitElement {
    @property() hass: HomeAssistant;
    @property() settings: any;


    render() {
        return html`
            <ha-card header="Asterisk AMI Configuration" outlined>
                <div class="card-content">
                    <ha-settings-row>
                        <span slot="heading">Hostname or IP</span>
                        <span slot="description">
                            The IP or hostname of the Asterisk server.
                        </span>
                        <ha-textfield .value="${this.settings.host || '127.0.0.1'}">
                        </ha-textfield>
                    </ha-settings-row>
                    <ha-settings-row>
                        <span slot="heading">Port</span>
                        <span slot="description">
                            The port of the AMI instance.
                        </span>
                        <ha-textfield .value="${this.settings.port || '5039'}">
                        </ha-textfield>
                    </ha-settings-row>
                    <ha-settings-row>
                        <span slot="heading">Username</span>
                        <span slot="description">
                            The AMI admin username.
                        </span>
                        <ha-textfield .value="${this.settings.username || 'admin'}">
                        </ha-textfield>
                    </ha-settings-row>
                    <ha-settings-row>
                        <span slot="heading">Password</span>
                        <span slot="description">
                            The AMI admin password.
                        </span>
                        <ha-textfield .value="${this.settings.password || ''}">
                        </ha-textfield>
                    </ha-settings-row>
                </div>
            </ha-card>
        `
    }
}