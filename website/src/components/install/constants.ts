/**
 * Install Wizard Constants
 *
 * Centralized configuration for the firmware installation wizard.
 */

/**
 * ESP Web Tools version used for firmware flashing.
 * Update this when upgrading the ESP Web Tools library.
 */
export const ESP_WEB_TOOLS_VERSION = '10.2.1';

/**
 * WiFi Access Point name created by the device during setup.
 * Users connect to this AP to configure WiFi if not done during flashing.
 */
export const WIFI_AP_NAME = 'Webex-Display-Setup';

/**
 * IP address of the device's WiFi AP configuration portal.
 * Access this URL when connected to the device's AP to configure settings.
 */
export const WIFI_AP_IP = '192.168.4.1';

/**
 * Browsers that support Web Serial API (required for ESP Web Tools).
 */
export const SUPPORTED_BROWSERS = {
  chrome: { name: 'Chrome', supported: true },
  edge: { name: 'Edge', supported: true },
  firefox: { name: 'Firefox', supported: false },
  safari: { name: 'Safari', supported: false },
} as const;

/**
 * Typical duration for firmware flashing process (in seconds).
 * Used for user expectations in UI messages.
 */
export const TYPICAL_FLASH_DURATION_SECONDS = 30;
export const TYPICAL_FLASH_DURATION_MAX_SECONDS = 60;
