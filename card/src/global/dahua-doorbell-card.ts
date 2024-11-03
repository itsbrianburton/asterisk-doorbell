import { html, LitElement, nothing } from 'lit';
import { state } from 'lit/decorators/state';

import { HassEntity } from 'home-assistant-js-websocket';
import { HomeAssistant, LovelaceCardConfig } from 'custom-card-helpers';

interface Config extends LovelaceCardConfig {
    header: string;
    entity: string;
}

export class DahuaDoorbellCard extends LitElement {
    @state() private _config: Config;
    @state() private _header: string | typeof nothing;
    @state() private _state: HassEntity;

    private _hass: any;
    private _session: any = {};

    constructor() {
        super();

        this._session = (window as any).dahua_doorbell;
    }

    setConfig(config: Config) {
        this._config = config;
        this._header = config.header === "" ? nothing : config.header;

        if (this._hass) {
            this.hass = this._hass;
        }
    }

    set hass(hass: HomeAssistant) {
        this._hass = hass;
    }

    render() {
        return html`
			<ha-card header="${this._header}">
				<div class="card-content">
                    <ha-button @click="${() => this._session?.answer()}">
                        <ha-icon icon="mdi:phone"></ha-icon> Answer
                    </ha-button>
                    <ha-button @click="${() => this._session?.terminate()}">
                        <ha-icon icon="mdi:phone-hangup"></ha-icon> Hang Up
                    </ha-button>
                </div>
			</ha-card>
		`;
    }

    static getConfigElement() {
        return document.createElement("dahua-doorbell-editor");
    }

    static getStubConfig() {
        return {
            entity: "input_boolean.dahua-doorbell",
            header: ""
        }
    }
}
