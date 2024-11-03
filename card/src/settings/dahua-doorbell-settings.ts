import {DahuaDoorbellAmiConfigCard} from "./ami-config";
import {DahuaDoorbellRegisteredBrowsersCard} from "./registered-browsers";
import {DahuaDoorbellPanel} from "./dahua-doorbell-panel";

export const loadConfigDashboard = async () => {
	await customElements.whenDefined("partial-panel-resolver");
	const ppResolver = document.createElement("partial-panel-resolver");
	const routes = (ppResolver as any).getRoutes([
		{
			component_name: "config",
			url_path: "a",
		},
	]);
	await routes?.routes?.a?.load?.();
	await customElements.whenDefined("ha-panel-config");
	const configRouter: any = document.createElement("ha-panel-config");
	await configRouter?.routerOptions?.routes?.dashboard?.load?.(); // Load ha-config-dashboard
	await configRouter?.routerOptions?.routes?.general?.load?.(); // Load ha-settings-row
	await configRouter?.routerOptions?.routes?.entities?.load?.(); // Load ha-data-table
	await customElements.whenDefined("ha-config-dashboard");
};

loadConfigDashboard()
	.then(() => {
		customElements.define(
			"dahua-doorbell-ami-config",
			DahuaDoorbellAmiConfigCard
		);

		customElements.define(
			"dahua-doorbell-registered-browsers",
			DahuaDoorbellRegisteredBrowsersCard
		);

		customElements.define(
			"dahua-doorbell-panel",
			DahuaDoorbellPanel
		);
	})
