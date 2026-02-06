/**
 * Webex Display Configuration UI JavaScript
 */

// API endpoints
const API = {
    status: '/api/status',
    config: '/api/config',
    wifiScan: '/api/wifi/scan',
    wifiSave: '/api/wifi/save',
    webexAuth: '/api/webex/auth',
    otaCheck: '/api/ota/check',
    otaUpdate: '/api/ota/update',
    otaBootloader: '/api/ota/bootloader',
    otaUpload: '/api/ota/upload',
    reboot: '/api/reboot',
    factoryReset: '/api/factory-reset',
    regeneratePairingCode: '/api/pairing/regenerate'
};

// State
let config = {};
let statusInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTabs(); // from common.js
    populateSelectOptions('time-zone', TIME_ZONES); // from common.js

    const params = new URLSearchParams(window.location.search);
    const isPortal = params.get('portal') === '1';
    if (isPortal) {
        showTab('wifi'); // from common.js
        hideNonWifiTabs();
    }

    loadStatus();
    loadConfig();
    loadPinConfig();
    initEventListeners();
    initPasswordToggle('wifi-password', 'wifi-show-password', isPortal); // from common.js

    // Start status polling
    statusInterval = setInterval(loadStatus, 5000);
});

function hideNonWifiTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab !== 'wifi') {
            btn.style.display = 'none';
        }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id !== 'wifi') {
            content.style.display = 'none';
        }
    });
}

// Load Status
let currentPairingCode = '';
async function loadStatus() {
    try {
        const response = await fetch(API.status);
        const data = await response.json();

        updateStatusDisplay(data);
        updateConnectionIndicators(data);

        document.getElementById('connection-status').classList.add('connected');
    } catch (error) {
        console.error('Failed to load status:', error);
        document.getElementById('connection-status').classList.remove('connected');
        document.getElementById('connection-status').classList.add('error');
    }
}

function updateStatusDisplay(data) {
    // Pairing code
    const pairingCodeEl = document.getElementById('pairing-code');
    if (pairingCodeEl && data.pairing_code) {
        pairingCodeEl.textContent = data.pairing_code;
        currentPairingCode = data.pairing_code;
    }
    
    const appStatusEl = document.getElementById('app-status');
    if (appStatusEl) {
        appStatusEl.textContent = data.embedded_app_connected ? 'Connected' : 'Waiting...';
        appStatusEl.style.color = data.embedded_app_connected ? '#6cc04a' : '#888';
    }
    
    // Webex status
    const statusEl = document.getElementById('webex-status');
    statusEl.textContent = data.webex_status || '--';
    statusEl.className = 'value ' + (data.webex_status || '').toLowerCase();

    // Camera/Mic/Call
    document.getElementById('camera-status').textContent = data.camera_on ? 'On' : 'Off';
    document.getElementById('mic-status').textContent = data.mic_muted ? 'Muted' : 'Unmuted';
    document.getElementById('call-status').textContent = data.in_call ? 'Yes' : 'No';

    // Sensors
    if (data.temperature != null && data.temperature !== undefined) {
        const tempF = (data.temperature * 9/5) + 32;
        document.getElementById('temperature').textContent = tempF.toFixed(1) + '°F';
    } else {
        document.getElementById('temperature').textContent = '--';
    }
    if (data.humidity != null && data.humidity !== undefined) {
        document.getElementById('humidity').textContent = data.humidity.toFixed(1) + '%';
    } else {
        document.getElementById('humidity').textContent = '--';
    }
    document.getElementById('door-status').textContent = data.door_status || '--';
    // Handle air_quality - 0 is a valid value, so check for null/undefined explicitly
    if (data.air_quality != null && data.air_quality !== undefined) {
        document.getElementById('air-quality').textContent = data.air_quality.toString();
    } else {
        document.getElementById('air-quality').textContent = '--';
    }
    if (data.tvoc != null && data.tvoc !== undefined) {
        document.getElementById('tvoc').textContent = data.tvoc.toFixed(1);
    } else {
        document.getElementById('tvoc').textContent = '--';
    }
    document.getElementById('sensor-mac').textContent = data.sensor_mac || '--';

    // System info
    document.getElementById('firmware-version').textContent = data.firmware_version || '--';
    document.getElementById('firmware-build-id').textContent = data.firmware_build_id || '--';
    document.getElementById('boot-partition').textContent = data.boot_partition || '--';
    
    // Partition versions
    if (data.partitions) {
        document.getElementById('ota0-version').textContent = 
            data.partitions.ota_0?.firmware_version || 'empty';
        document.getElementById('ota1-version').textContent = 
            data.partitions.ota_1?.firmware_version || 'empty';
        
        // Filesystem usage
        if (data.partitions.filesystem) {
            const fs = data.partitions.filesystem;
            const usedPct = Math.round((fs.free / fs.total) * 100);
            document.getElementById('fs-usage').textContent = 
                `${formatBytes(fs.free)} free / ${formatBytes(fs.total)} (${usedPct}% free)`;
        } else {
            document.getElementById('fs-usage').textContent = 'n/a';
        }
    } else {
        // Older firmware without partition info
        document.getElementById('ota0-version').textContent = 'n/a';
        document.getElementById('ota1-version').textContent = 'n/a';
        document.getElementById('fs-usage').textContent = 'n/a';
    }
    
    document.getElementById('current-version').textContent = data.firmware_version || '--';
    document.getElementById('current-build-id').textContent = data.firmware_build_id || '--';
    document.getElementById('ip-address').textContent = data.ip_address || '--';
    document.getElementById('mac-address').textContent = data.mac_address || '--';
    document.getElementById('serial-number').textContent = data.serial_number || '--';
    const hmacEl = document.getElementById('hmac-status');
    if (hmacEl) {
        hmacEl.textContent = data.hmac_enabled ? 'Enabled' : 'Disabled';
        hmacEl.style.color = data.hmac_enabled ? '#6cc04a' : '#ff5c5c';
    }
    document.getElementById('free-heap').textContent = formatBytes(data.free_heap);
    document.getElementById('uptime').textContent = formatUptime(data.uptime);
}

function updateConnectionIndicators(data) {
    updateConnectionItem('conn-wifi', data.wifi_connected); // from common.js
    updateConnectionItem('conn-webex', data.webex_authenticated); // from common.js
    updateConnectionItem('conn-mqtt', data.mqtt_connected); // from common.js
    
    // WiFi SSID status
    const wifiSsidSavedEl = document.getElementById('wifi-ssid-saved');
    if (wifiSsidSavedEl) {
        if (data.wifi_ssid_saved && data.wifi_ssid) {
            wifiSsidSavedEl.textContent = data.wifi_ssid;
            wifiSsidSavedEl.style.color = '#6cc04a'; // green
        } else {
            wifiSsidSavedEl.textContent = 'Not configured';
            wifiSsidSavedEl.style.color = '#ff5c5c'; // red
        }
    }
    const wifiPasswordStatus = document.getElementById('wifi-password-status');
    if (wifiPasswordStatus) {
        if (data.has_wifi_password) {
            wifiPasswordStatus.textContent = 'Saved';
            wifiPasswordStatus.style.color = '#6cc04a'; // green
        } else {
            wifiPasswordStatus.textContent = 'Not set';
            wifiPasswordStatus.style.color = '#ff5c5c'; // red
        }
    }
    // Pre-fill WiFi SSID input with saved value
    const wifiSsidInput = document.getElementById('wifi-ssid');
    if (wifiSsidInput && data.wifi_ssid && !wifiSsidInput.value) {
        wifiSsidInput.value = data.wifi_ssid;
    }
}

// Load Configuration
async function loadConfig() {
    try {
        const response = await fetch(API.config);
        config = await response.json();

        // Populate form fields
        document.getElementById('display-name').value = config.display_name || '';
        document.getElementById('brightness').value = config.brightness || 128;
        document.getElementById('brightness-value').textContent = config.brightness || 128;
        document.getElementById('scroll-speed').value = config.scroll_speed_ms || 250;
        document.getElementById('scroll-speed-value').textContent = config.scroll_speed_ms || 250;
        
        // Page/layout settings
        const displayPagesEl = document.getElementById('display-pages');
        if (displayPagesEl) {
            const pagesValue = config.display_pages || (config.sensor_page_enabled === false ? 'status' : 'rotate');
            displayPagesEl.value = pagesValue;
        }
        const statusLayoutEl = document.getElementById('status-layout');
        if (statusLayoutEl) {
            statusLayoutEl.value = config.status_layout || 'sensors';
        }
        const pageIntervalSec = Math.round((config.page_interval_ms || 5000) / 1000);
        document.getElementById('page-interval').value = pageIntervalSec;
        document.getElementById('page-interval-value').textContent = pageIntervalSec;
        
        // Border width setting
        document.getElementById('border-width').value = config.border_width || 1;
        document.getElementById('date-color').value = config.date_color || '#00ffff';
        document.getElementById('time-color').value = config.time_color || '#ffffff';
        document.getElementById('name-color').value = config.name_color || '#ffa500';
        document.getElementById('metric-color').value = config.metric_color || '#00bfff';
        
        document.getElementById('poll-interval').value = config.poll_interval || 30;
        document.getElementById('xapi-device-id').value = config.xapi_device_id || '';
        
        // MQTT configuration
        document.getElementById('mqtt-broker').value = config.mqtt_broker || '';
        document.getElementById('mqtt-port').value = config.mqtt_port || 1883;
        document.getElementById('mqtt-topic').value = config.mqtt_topic || 'meraki/v1/mt/#';
        document.getElementById('mqtt-username').value = config.mqtt_username || '';
        
        // MQTT password - show placeholder if exists
        const mqttPasswordInput = document.getElementById('mqtt-password');
        if (config.has_mqtt_password) {
            mqttPasswordInput.placeholder = config.mqtt_password_masked || '••••••••';
        } else {
            mqttPasswordInput.placeholder = 'Enter MQTT password';
        }
        mqttPasswordInput.value = ''; // Never populate password fields
        
        const sensorMacsInput = document.getElementById('sensor-macs');
        const sensorMacsValue = config.sensor_macs || '';
        sensorMacsInput.value = sensorMacsValue;
        if (!sensorMacsValue && config.sensor_serial) {
            sensorMacsInput.placeholder = `Legacy serial: ${config.sensor_serial}`;
        }
        document.getElementById('display-sensor-mac').value = config.display_sensor_mac || '';
        document.getElementById('display-metric').value = config.display_metric || 'tvoc';
        document.getElementById('ota-url').value = config.ota_url || '';
        document.getElementById('auto-update').checked = config.auto_update || false;
        document.getElementById('debug-mode').checked = config.debug_mode || false;
        document.getElementById('pairing-realtime-debug').checked = config.pairing_realtime_debug || false;
        document.getElementById('tls-verify').checked = config.tls_verify !== false;
        document.getElementById('time-format').value = config.time_format || '24h';
        document.getElementById('date-format').value = config.date_format || 'mdy';
        document.getElementById('ntp-server').value = config.ntp_server || 'pool.ntp.org';
        const timeZoneSelect = document.getElementById('time-zone');
        const timeZoneValue = config.time_zone || 'UTC';
        ensureSelectOption(timeZoneSelect, timeZoneValue); // from common.js
        timeZoneSelect.value = timeZoneValue;

        // Webex credentials - show masked values in Advanced
        const clientIdInput = document.getElementById('webex-client-id');
        const clientSecretInput = document.getElementById('webex-client-secret');
        const clientIdMask = document.getElementById('webex-client-id-mask');
        const clientSecretMask = document.getElementById('webex-client-secret-mask');
        const editToggle = document.getElementById('webex-edit-toggle');
        const webexForm = document.getElementById('webex-form');

        if (clientIdMask) {
            clientIdMask.value = config.has_webex_credentials ? 'xxxxxxxx' : 'not set';
        }
        if (clientSecretMask) {
            clientSecretMask.value = config.has_webex_credentials ? 'xxxxxxxx' : 'not set';
        }
        if (editToggle) {
            editToggle.checked = false;
        }
        if (webexForm) {
            webexForm.style.display = 'none';
        }
        // Never populate credential fields - leave empty for security
        clientIdInput.value = '';
        clientSecretInput.value = '';

        // Update auth status - check actual authentication state (Supabase or local)
        const authStatus = document.getElementById('webex-auth-status');
        const redirectNote = document.getElementById('webex-redirect-note');
        if (config.webex_authenticated) {
            // Connected via Supabase OAuth or local tokens
            authStatus.textContent = 'Connected via display.5ls.us';
            authStatus.style.color = '#6cc04a';
            if (redirectNote) redirectNote.textContent = 'Your Webex account is authorized.';
        } else if (config.has_webex_credentials) {
            authStatus.textContent = 'Credentials saved, not authorized';
            authStatus.style.color = '#ffcc00';
            if (redirectNote) redirectNote.textContent = 'Click above to authorize via display.5ls.us';
        } else {
            authStatus.textContent = 'Not configured';
            authStatus.style.color = '#ff5c5c';
            if (redirectNote) redirectNote.textContent = 'Click above to authorize via display.5ls.us';
        }

    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Event Listeners
function initEventListeners() {
    // Brightness slider
    document.getElementById('brightness').addEventListener('input', (e) => {
        document.getElementById('brightness-value').textContent = e.target.value;
    });
    document.getElementById('scroll-speed').addEventListener('input', (e) => {
        document.getElementById('scroll-speed-value').textContent = e.target.value;
    });
    document.getElementById('page-interval').addEventListener('input', (e) => {
        document.getElementById('page-interval-value').textContent = e.target.value;
    });

    // WiFi scan
    document.getElementById('scan-wifi').addEventListener('click', () => {
        scanWifi({ // from common.js
            scanBtnId: 'scan-wifi',
            listElId: 'wifi-networks',
            ssidInputId: 'wifi-ssid',
            endpoint: API.wifiScan
        });
    });

    // WiFi form
    document.getElementById('wifi-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveWifi({ // from common.js
            ssidInputId: 'wifi-ssid',
            passwordInputId: 'wifi-password',
            endpoint: API.wifiSave
        });
    });

    // Webex form
    document.getElementById('webex-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editToggle = document.getElementById('webex-edit-toggle');
        if (editToggle && !editToggle.checked) {
            alert('No changes to Webex credentials.');
            return;
        }

        const clientId = document.getElementById('webex-client-id').value.trim();
        const clientSecret = document.getElementById('webex-client-secret').value.trim();

        if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
            alert('Both Client ID and Client Secret are required to update credentials.');
            return;
        }
        if (!clientId && !clientSecret) {
            alert('Please enter both Client ID and Client Secret');
            return;
        }

        await saveConfig({
            webex_client_id: clientId,
            webex_client_secret: clientSecret
        }, {
            endpoint: API.config,
            successMessage: 'Webex credentials saved successfully!',
            onSuccess: loadConfig
        });
    });

    // Webex auth button
    document.getElementById('webex-auth-btn').addEventListener('click', () => {
        startWebexAuth({ // from common.js
            endpoint: API.webexAuth,
            onSuccess: (data) => {
                const redirectField = document.getElementById('webex-redirect-uri');
                const redirectNote = document.getElementById('webex-redirect-note');
                if (redirectField) {
                    redirectField.value = data.auth_url;
                }
                if (redirectNote) {
                    redirectNote.textContent = 'Authorize Webex via display.5ls.us.';
                }
            }
        });
    });

    const webexEditToggle = document.getElementById('webex-edit-toggle');
    const webexForm = document.getElementById('webex-form');
    if (webexEditToggle && webexForm) {
        webexEditToggle.addEventListener('change', () => {
            webexForm.style.display = webexEditToggle.checked ? 'block' : 'none';
        });
    }
    
    // Regenerate pairing code button
    const regenerateBtn = document.getElementById('regenerate-code');
    if (regenerateBtn) {
        regenerateBtn.addEventListener('click', regeneratePairingCode);
    }

    // xAPI form
    document.getElementById('xapi-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            xapi_device_id: document.getElementById('xapi-device-id').value
        }, {
            endpoint: API.config,
            successMessage: 'xAPI device saved!'
        });
    });

    // MQTT form
    document.getElementById('mqtt-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const broker = document.getElementById('mqtt-broker').value.trim();
        if (!broker) {
            alert('MQTT Broker address is required');
            return;
        }

        const password = document.getElementById('mqtt-password').value;
        const data = {
            mqtt_broker: broker,
            mqtt_port: parseInt(document.getElementById('mqtt-port').value) || 1883,
            mqtt_username: document.getElementById('mqtt-username').value.trim(),
            mqtt_topic: document.getElementById('mqtt-topic').value.trim() || 'meraki/v1/mt/#',
            sensor_macs: document.getElementById('sensor-macs').value.trim(),
            display_sensor_mac: document.getElementById('display-sensor-mac').value.trim(),
            display_metric: document.getElementById('display-metric').value
        };
        if (password) {
            data.mqtt_password = password;
        }

        await saveConfig(data, {
            endpoint: API.config,
            successMessage: 'MQTT configuration saved successfully!',
            onSuccess: loadConfig
        });
    });

    // MQTT debug checkbox
    const mqttDebugCheckbox = document.getElementById('mqtt-debug');
    if (mqttDebugCheckbox) {
        // Load current state
        fetch('/api/mqtt/debug')
            .then(r => r.json())
            .then(data => {
                mqttDebugCheckbox.checked = data.debug_enabled || false;
            })
            .catch(() => {});
        
        // Handle changes
        mqttDebugCheckbox.addEventListener('change', async (e) => {
            try {
                const response = await fetch('/api/mqtt/debug', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: e.target.checked })
                });
                const data = await response.json();
                if (!data.success) {
                    console.error('Failed to toggle MQTT debug');
                }
            } catch (err) {
                console.error('Error toggling MQTT debug:', err);
            }
        });
    }

    // Display form
    document.getElementById('display-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            display_name: document.getElementById('display-name').value,
            brightness: parseInt(document.getElementById('brightness').value),
            poll_interval: parseInt(document.getElementById('poll-interval').value),
            scroll_speed_ms: parseInt(document.getElementById('scroll-speed').value),
            display_pages: document.getElementById('display-pages').value,
            status_layout: document.getElementById('status-layout').value,
            sensor_page_enabled: document.getElementById('display-pages').value === 'rotate',
            page_interval_ms: parseInt(document.getElementById('page-interval').value) * 1000,
            border_width: parseInt(document.getElementById('border-width').value),
            date_color: document.getElementById('date-color').value,
            time_color: document.getElementById('time-color').value,
            name_color: document.getElementById('name-color').value,
            metric_color: document.getElementById('metric-color').value,
            time_format: document.getElementById('time-format').value,
            date_format: document.getElementById('date-format').value,
            time_zone: document.getElementById('time-zone').value,
            ntp_server: document.getElementById('ntp-server').value.trim() || 'pool.ntp.org'
        }, {
            endpoint: API.config,
            successMessage: 'Display settings saved!',
            onSuccess: loadConfig
        });
    });

    // Time form
    document.getElementById('time-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            time_format: document.getElementById('time-format').value,
            date_format: document.getElementById('date-format').value,
            time_zone: document.getElementById('time-zone').value,
            ntp_server: document.getElementById('ntp-server').value.trim() || 'pool.ntp.org'
        }, {
            endpoint: API.config,
            successMessage: 'Time settings saved!',
            onSuccess: loadConfig
        });
    });

    // OTA form and buttons
    document.getElementById('ota-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            ota_url: document.getElementById('ota-url').value.trim(),
            auto_update: document.getElementById('auto-update').checked
        }, {
            endpoint: API.config,
            successMessage: 'OTA settings saved!',
            onSuccess: loadConfig
        });
    });
    document.getElementById('check-update').addEventListener('click', () => {
        checkForUpdate({ // from common.js
            btnId: 'check-update',
            latestElId: 'latest-version',
            updateBtnId: 'perform-update',
            endpoint: API.otaCheck
        });
    });
    document.getElementById('perform-update').addEventListener('click', () => {
        performUpdate({ // from common.js
            endpoint: API.otaUpdate
        });
    });
    
    initFileUpload({ // from common.js
        fileInputId: 'ota-file',
        uploadBtnId: 'ota-upload-btn',
        statusElId: 'ota-upload-status',
        onUpload: uploadFirmware
    });

    // Debug form
    document.getElementById('debug-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            debug_mode: document.getElementById('debug-mode').checked,
            pairing_realtime_debug: document.getElementById('pairing-realtime-debug').checked,
            tls_verify: document.getElementById('tls-verify').checked
        }, {
            endpoint: API.config,
            successMessage: 'Debug settings saved!',
            onSuccess: loadConfig
        });
    });

    // System buttons
    document.getElementById('reboot-btn').addEventListener('click', () => {
        rebootDevice({ endpoint: API.reboot }); // from common.js
    });
    document.getElementById('boot-bootstrap-btn').addEventListener('click', bootToBootstrap);
    document.getElementById('factory-reset-btn').addEventListener('click', () => {
        factoryReset({ endpoint: API.factoryReset }); // from common.js
    });
    
    // Pin configuration form
    const pinConfigForm = document.getElementById('pin-config-form');
    if (pinConfigForm) {
        pinConfigForm.addEventListener('submit', savePinConfig);
    }
}

// WiFi Functions (use common.js)
// scanWifi and saveWifi are in common.js

// Webex Functions (use common.js)
// startWebexAuth is in common.js

// Pairing code regeneration
async function regeneratePairingCode() {
    if (!confirm('Generate a new pairing code? You will need to re-pair the embedded app.')) {
        return;
    }
    
    try {
        const response = await fetch(API.regeneratePairingCode, { method: 'POST' });
        const data = await response.json();
        
        if (data.success && data.code) {
            document.getElementById('pairing-code').textContent = data.code;
            alert('New pairing code generated: ' + data.code);
        } else {
            alert(data.error || 'Failed to regenerate pairing code');
        }
    } catch (error) {
        alert('Failed to regenerate pairing code');
    }
}

// OTA Functions (use common.js)
// checkForUpdate and performUpdate are in common.js

function uploadFirmware({ fileInput, uploadBtn, statusEl }) {
    if (!fileInput.files || fileInput.files.length === 0) {
        statusEl.textContent = 'No file selected.';
        return;
    }

    if (!confirm('Upload firmware file? The device will restart when complete.')) {
        return;
    }

    const file = fileInput.files[0];

    uploadBtn.disabled = true;
    statusEl.textContent = 'Uploading...';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', API.otaUpload);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
            return;
        }
        const percent = Math.round((event.loaded / event.total) * 100);
        statusEl.textContent = `Uploading... ${percent}%`;
    };

    xhr.onload = () => {
        let message = 'Upload complete. Rebooting...';
        let wasSuccessful = xhr.status >= 200 && xhr.status < 300;

        if (xhr.responseText) {
            try {
                const response = JSON.parse(xhr.responseText);
                if (typeof response.success === 'boolean') {
                    wasSuccessful = response.success;
                }
                message = response.message || message;
            } catch (error) {
                console.error('Upload response parse failed:', error);
            }
        }

        statusEl.textContent = message;
        if (!wasSuccessful) {
            uploadBtn.disabled = false;
        }
    };

    xhr.onerror = () => {
        statusEl.textContent = 'Upload failed. Please try again.';
        uploadBtn.disabled = false;
    };

    xhr.send(file);
}

// System Functions (use common.js)
// rebootDevice and factoryReset are in common.js

async function bootToBootstrap() {
    if (!confirm('Reboot into bootstrap firmware?')) {
        return;
    }
    if (!confirm('This will reboot into the bootstrap UI for OTA install. Continue?')) {
        return;
    }

    try {
        await fetch(API.otaBootloader, { method: 'POST' });
        alert('Device is rebooting to bootstrap firmware...');
    } catch (error) {
        alert('Failed to reboot to bootstrap');
    }
}

// Pin Configuration Functions
async function loadPinConfig() {
    try {
        const response = await fetch('/api/config/pins');
        if (!response.ok) {
            console.warn('Pin config not available');
            return;
        }
        const data = await response.json();
        
        // Update board info
        const boardTypeEl = document.getElementById('board-type');
        const presetNameEl = document.getElementById('pin-preset-name');
        if (boardTypeEl) boardTypeEl.textContent = data.chip_description || data.board_type;
        if (presetNameEl) presetNameEl.textContent = data.preset_name;
        
        // Populate preset dropdown
        const presetSelect = document.getElementById('pin-preset');
        if (presetSelect && data.available_presets) {
            presetSelect.innerHTML = data.available_presets.map(p => 
                `<option value="${p.id}" ${p.id === data.preset ? 'selected' : ''}>${p.name}</option>`
            ).join('');
            
            // Show/hide custom pins section
            presetSelect.addEventListener('change', () => {
                const customSection = document.getElementById('custom-pins-section');
                customSection.style.display = presetSelect.value === '3' ? 'block' : 'none';
            });
            
            // Trigger initial state
            const customSection = document.getElementById('custom-pins-section');
            if (customSection) {
                customSection.style.display = data.preset === 3 ? 'block' : 'none';
            }
        }
        
        // Populate current pin values
        if (data.pins) {
            const pinFields = ['r1', 'g1', 'b1', 'r2', 'g2', 'b2', 'a', 'b', 'c', 'd', 'e', 'clk', 'lat', 'oe'];
            pinFields.forEach(pin => {
                const el = document.getElementById(`pin-${pin}`);
                if (el) el.value = data.pins[pin];
            });
        }
        
        console.log('Pin configuration loaded');
    } catch (error) {
        console.error('Failed to load pin config:', error);
    }
}

async function savePinConfig(event) {
    event.preventDefault();
    
    const presetSelect = document.getElementById('pin-preset');
    const preset = parseInt(presetSelect.value, 10);
    
    const payload = { preset };
    
    // If custom preset, include pin values
    if (preset === 3) {
        payload.pins = {
            r1: parseInt(document.getElementById('pin-r1').value, 10),
            g1: parseInt(document.getElementById('pin-g1').value, 10),
            b1: parseInt(document.getElementById('pin-b1').value, 10),
            r2: parseInt(document.getElementById('pin-r2').value, 10),
            g2: parseInt(document.getElementById('pin-g2').value, 10),
            b2: parseInt(document.getElementById('pin-b2').value, 10),
            a: parseInt(document.getElementById('pin-a').value, 10),
            b: parseInt(document.getElementById('pin-b').value, 10),
            c: parseInt(document.getElementById('pin-c').value, 10),
            d: parseInt(document.getElementById('pin-d').value, 10),
            e: parseInt(document.getElementById('pin-e').value, 10),
            clk: parseInt(document.getElementById('pin-clk').value, 10),
            lat: parseInt(document.getElementById('pin-lat').value, 10),
            oe: parseInt(document.getElementById('pin-oe').value, 10)
        };
    }
    
    try {
        const response = await fetch('/api/config/pins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to save pin config');
        }
        
        const result = await response.json();
        alert(result.message || 'Pin configuration saved');
        
        if (result.reboot_required || result.message?.includes('reboot')) {
            if (confirm('Pin configuration saved. Reboot now to apply changes?')) {
                await fetch(API.reboot, { method: 'POST' });
                alert('Device rebooting...');
            }
        }
    } catch (error) {
        alert(`Failed to save pin config: ${error.message}`);
        console.error('Pin config save error:', error);
    }
}

// Utility Functions are in common.js (formatBytes, formatUptime)
