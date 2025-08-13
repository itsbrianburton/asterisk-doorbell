/**
 * This file contains hooks for the Home Assistant integration
 * to register custom websocket commands
 */
import { HomeAssistant } from 'custom-card-helpers';

/**
 * Register a custom websocket command to fetch ARI settings
 * @param hass Home Assistant instance
 */
export const registerWebSocketCommands = (hass: HomeAssistant) => {
    // Only register commands once
    if ((window as any).asteriskCommandsRegistered) {
        return;
    }

    // Hook for getting settings
    hass.connection.subscribeMessage(
        (result) => {
            // Stub for message callback
            console.log('Received settings response', result);
        },
        {
            type: 'asterisk_doorbell/get_settings',
        }
    );

    // Mark as registered to avoid duplicate registration
    (window as any).asteriskCommandsRegistered = true;
};