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
    regeneratePairingCode: '/api/pairing/regenerate',
    bridgeClear: '/api/bridge/clear'
};

const TIME_ZONES = [
    { value: 'UTC', label: 'UTC' },
    { value: 'America/New_York', label: 'America/New_York (ET)' },
    { value: 'America/Chicago', label: 'America/Chicago (CT)' },
    { value: 'America/Denver', label: 'America/Denver (MT)' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
    { value: 'America/Phoenix', label: 'America/Phoenix (AZ)' },
    { value: 'America/Anchorage', label: 'America/Anchorage (AK)' },
    { value: 'America/Honolulu', label: 'America/Honolulu (HI)' },
    { value: 'Europe/London', label: 'Europe/London' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin' },
    { value: 'Europe/Paris', label: 'Europe/Paris' },
    { value: 'Europe/Madrid', label: 'Europe/Madrid' },
    { value: 'Europe/Rome', label: 'Europe/Rome' },
    { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam' },
    { value: 'Europe/Zurich', label: 'Europe/Zurich' },
    { value: 'Europe/Moscow', label: 'Europe/Moscow' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
    { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
    { value: 'Asia/Singapore', label: 'Asia/Singapore' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
    { value: 'Australia/Sydney', label: 'Australia/Sydney' },
    { value: 'Australia/Perth', label: 'Australia/Perth' },
    { value: 'Pacific/Auckland', label: 'Pacific/Auckland' }
];

// State
let config = {};
let statusInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    populateTimeZones();

    const params = new URLSearchParams(window.location.search);
    const isPortal = params.get('portal') === '1';
    if (isPortal) {
        showTab('wifi');
        hideNonWifiTabs();
    }

    loadStatus();
    loadConfig();
    initEventListeners();
    initPasswordToggle(isPortal);

    // Start status polling
    statusInterval = setInterval(loadStatus, 5000);
});

// Tab Navigation
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            showTab(tabId);
        });
    });
}

function initPasswordToggle(isPortal) {
    const passwordInput = document.getElementById('wifi-password');
    const toggle = document.getElementById('wifi-show-password');
    if (!passwordInput || !toggle) {
        return;
    }
    toggle.addEventListener('change', () => {
        passwordInput.type = toggle.checked ? 'text' : 'password';
    });

    // In captive portal mode, default to showing password
    if (isPortal) {
        toggle.checked = true;
        passwordInput.type = 'text';
    }
}

function showTab(tabId) {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    const activeContent = document.getElementById(tabId);
    if (activeContent) {
        activeContent.classList.add('active');
    }
}

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

function populateTimeZones() {
    const select = document.getElementById('time-zone');
    if (!select) {
        return;
    }
    select.innerHTML = '';
    TIME_ZONES.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone.value;
        option.textContent = zone.label;
        select.appendChild(option);
    });
}

function ensureSelectOption(selectEl, value) {
    if (!selectEl || !value) {
        return;
    }
    const hasOption = Array.from(selectEl.options).some(option => option.value === value);
    if (!hasOption) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        selectEl.appendChild(option);
    }
}

// Load Status
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
    }
    
    // Bridge/App status
    const bridgeStatusEl = document.getElementById('bridge-status');
    if (bridgeStatusEl) {
        bridgeStatusEl.textContent = data.bridge_connected ? 'Connected' : 'Disconnected';
        bridgeStatusEl.style.color = data.bridge_connected ? '#6cc04a' : '#ff5c5c';
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
    document.getElementById('free-heap').textContent = formatBytes(data.free_heap);
    document.getElementById('uptime').textContent = formatUptime(data.uptime);
}

function updateConnectionIndicators(data) {
    updateConnectionItem('conn-wifi', data.wifi_connected);
    updateConnectionItem('conn-webex', data.webex_authenticated);
    updateConnectionItem('conn-bridge', data.bridge_connected);
    updateConnectionItem('conn-mqtt', data.mqtt_connected);
}

function updateConnectionItem(id, connected) {
    const el = document.getElementById(id);
    if (connected) {
        el.classList.add('connected');
    } else {
        el.classList.remove('connected');
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
        document.getElementById('time-format').value = config.time_format || '24h';
        document.getElementById('date-format').value = config.date_format || 'mdy';
        document.getElementById('ntp-server').value = config.ntp_server || 'pool.ntp.org';
        const timeZoneSelect = document.getElementById('time-zone');
        const timeZoneValue = config.time_zone || 'UTC';
        ensureSelectOption(timeZoneSelect, timeZoneValue);
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

        // Update auth status
        const authStatus = document.getElementById('webex-auth-status');
        if (config.has_webex_tokens) {
            authStatus.textContent = 'Connected';
            authStatus.style.color = '#6cc04a';
        } else if (config.has_webex_credentials) {
            authStatus.textContent = 'Credentials saved, not authorized';
            authStatus.style.color = '#ffcc00';
        } else {
            authStatus.textContent = 'Not configured';
            authStatus.style.color = '#ff5c5c';
        }

        // Update bridge form
        updateBridgeFormFromConfig(config);
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

    // WiFi scan
    document.getElementById('scan-wifi').addEventListener('click', scanWifi);

    // WiFi form
    document.getElementById('wifi-form').addEventListener('submit', saveWifi);

    // Bridge form
    initBridgeForm();

    // Webex form
    document.getElementById('webex-form').addEventListener('submit', saveWebexCredentials);

    // Webex auth button
    document.getElementById('webex-auth-btn').addEventListener('click', startWebexAuth);

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
    document.getElementById('xapi-form').addEventListener('submit', saveXAPIConfig);

    // MQTT form
    document.getElementById('mqtt-form').addEventListener('submit', saveMQTTConfig);

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
    document.getElementById('display-form').addEventListener('submit', saveDisplaySettings);

    // Time form
    document.getElementById('time-form').addEventListener('submit', saveTimeSettings);

    // OTA form and buttons
    document.getElementById('ota-form').addEventListener('submit', saveOTASettings);
    document.getElementById('check-update').addEventListener('click', checkForUpdate);
    document.getElementById('perform-update').addEventListener('click', performUpdate);
    initManualUpload();

    // Debug form
    document.getElementById('debug-form').addEventListener('submit', saveDebugSettings);

    // System buttons
    document.getElementById('reboot-btn').addEventListener('click', rebootDevice);
    document.getElementById('boot-bootstrap-btn').addEventListener('click', bootToBootstrap);
    document.getElementById('factory-reset-btn').addEventListener('click', factoryReset);
}

// Bridge Functions
function initBridgeForm() {
    const modeSelect = document.getElementById('bridge-mode');
    const urlSection = document.getElementById('bridge-url-section');
    const manualSection = document.getElementById('bridge-manual-section');
    const bridgeForm = document.getElementById('bridge-form');
    const clearBtn = document.getElementById('bridge-clear');

    if (!modeSelect || !bridgeForm) {
        return;
    }

    // Show/hide sections based on mode
    modeSelect.addEventListener('change', () => {
        const mode = modeSelect.value;
        urlSection.style.display = mode === 'url' ? 'block' : 'none';
        manualSection.style.display = mode === 'manual' ? 'block' : 'none';
    });

    bridgeForm.addEventListener('submit', saveBridgeConfig);
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearBridgeConfig);
    }
}

function updateBridgeFormFromConfig(config) {
    const modeSelect = document.getElementById('bridge-mode');
    const urlSection = document.getElementById('bridge-url-section');
    const manualSection = document.getElementById('bridge-manual-section');
    const currentUrlEl = document.getElementById('bridge-current-url');

    if (!modeSelect) {
        return;
    }

    // Determine mode from saved config
    let mode = 'auto';
    let displayUrl = 'Auto (Cloud)';

    if (config.bridge_url && config.bridge_url.trim() !== '') {
        mode = 'url';
        displayUrl = config.bridge_url;
        document.getElementById('bridge-url').value = config.bridge_url;
    } else if (config.bridge_host && config.bridge_host.trim() !== '') {
        mode = 'manual';
        document.getElementById('bridge-host').value = config.bridge_host;
        document.getElementById('bridge-port').value = config.bridge_port || 8080;
        document.getElementById('bridge-use-ssl').checked = config.bridge_use_ssl || false;
        
        const protocol = config.bridge_use_ssl ? 'wss' : 'ws';
        displayUrl = `${protocol}://${config.bridge_host}:${config.bridge_port || 8080}`;
    }

    modeSelect.value = mode;
    urlSection.style.display = mode === 'url' ? 'block' : 'none';
    manualSection.style.display = mode === 'manual' ? 'block' : 'none';

    if (currentUrlEl) {
        currentUrlEl.textContent = displayUrl;
    }
}

async function saveBridgeConfig(e) {
    e.preventDefault();

    const mode = document.getElementById('bridge-mode').value;
    const data = {};

    if (mode === 'url') {
        const url = document.getElementById('bridge-url').value.trim();
        if (!url) {
            alert('Please enter a bridge URL');
            return;
        }
        data.bridge_url = url;
        data.bridge_host = '';
        data.bridge_port = 443;
        data.bridge_use_ssl = true;
    } else if (mode === 'manual') {
        const host = document.getElementById('bridge-host').value.trim();
        if (!host) {
            alert('Please enter a bridge host');
            return;
        }
        data.bridge_url = '';
        data.bridge_host = host;
        data.bridge_port = parseInt(document.getElementById('bridge-port').value) || 8080;
        data.bridge_use_ssl = document.getElementById('bridge-use-ssl').checked;
    } else {
        // Auto mode - clear config
        data.bridge_url = '';
        data.bridge_host = '';
        data.bridge_port = 443;
        data.bridge_use_ssl = true;
    }

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert('Bridge configuration saved! The device will reconnect to the bridge.');
            loadConfig();
        } else {
            alert('Failed to save bridge config - server returned error');
        }
    } catch (error) {
        console.error('Error saving bridge config:', error);
        alert('Failed to save bridge config - network error');
    }
}

async function clearBridgeConfig() {
    if (!confirm('Clear bridge configuration and use auto-discovery?')) {
        return;
    }

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bridge_url: '',
                bridge_host: '',
                bridge_port: 443,
                bridge_use_ssl: true
            })
        });

        if (response.ok) {
            alert('Bridge configuration cleared. Using auto-discovery.');
            loadConfig();
        } else {
            alert('Failed to clear bridge config');
        }
    } catch (error) {
        alert('Failed to clear bridge config');
    }
}

// WiFi Functions
async function scanWifi() {
    const btn = document.getElementById('scan-wifi');
    const listEl = document.getElementById('wifi-networks');

    btn.disabled = true;
    btn.textContent = 'Scanning...';
    listEl.innerHTML = '<p>Scanning...</p>';

    try {
        // Start the scan
        const startResponse = await fetch(API.wifiScan);
        const startData = await startResponse.json();
        
        // If scan is already complete (results available immediately)
        if (startResponse.status === 200 && startData.networks) {
            displayNetworks(startData.networks, listEl);
            btn.disabled = false;
            btn.textContent = 'Scan Networks';
            return;
        }
        
        // If scan started or in progress, poll for results
        if (startResponse.status === 202) {
            // Poll every 500ms for up to 10 seconds
            const maxAttempts = 20;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const pollResponse = await fetch(API.wifiScan);
                const pollData = await pollResponse.json();
                
                if (pollResponse.status === 200 && pollData.networks) {
                    displayNetworks(pollData.networks, listEl);
                    btn.disabled = false;
                    btn.textContent = 'Scan Networks';
                    return;
                }
            }
            
            // Timeout after 10 seconds
            listEl.innerHTML = '<p>Scan timeout - please try again</p>';
        } else {
            listEl.innerHTML = '<p>Scan failed</p>';
        }
    } catch (error) {
        console.error('WiFi scan error:', error);
        listEl.innerHTML = '<p>Scan failed - ' + error.message + '</p>';
    }

    btn.disabled = false;
    btn.textContent = 'Scan Networks';
}

function displayNetworks(networks, listEl) {
    listEl.innerHTML = '';
    if (!networks || networks.length === 0) {
        listEl.innerHTML = '<p>No networks found</p>';
        return;
    }
    
    networks.forEach(network => {
        const item = document.createElement('div');
        item.className = 'network-item';
        item.innerHTML = `
            <span class="ssid">${network.ssid || '(hidden)'}</span>
            <span class="signal">${network.rssi} dBm ${network.encrypted ? '🔒' : ''}</span>
        `;
        item.addEventListener('click', () => {
            document.getElementById('wifi-ssid').value = network.ssid;
        });
        listEl.appendChild(item);
    });
}

async function saveWifi(e) {
    e.preventDefault();

    const ssidRaw = document.getElementById('wifi-ssid').value;
    const passwordRaw = document.getElementById('wifi-password').value;
    const ssid = ssidRaw.replace(/[\r\n\t]/g, '').trim();
    const password = passwordRaw.replace(/[\r\n\t]/g, '');

    try {
        const response = await fetch(API.wifiSave, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password })
        });
        const data = await response.json();
        alert(data.message || 'WiFi saved!');
    } catch (error) {
        alert('Failed to save WiFi settings');
    }
}

// Webex Functions
async function saveWebexCredentials(e) {
    e.preventDefault();

    const editToggle = document.getElementById('webex-edit-toggle');
    if (editToggle && !editToggle.checked) {
        alert('No changes to Webex credentials.');
        return;
    }

    const clientId = document.getElementById('webex-client-id').value.trim();
    const clientSecret = document.getElementById('webex-client-secret').value.trim();

    // If only one field is filled, require both
    if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
        alert('Both Client ID and Client Secret are required to update credentials.');
        return;
    }

    if (!clientId && !clientSecret) {
        alert('Please enter both Client ID and Client Secret');
        return;
    }

    const data = {
        webex_client_id: clientId,
        webex_client_secret: clientSecret
    };

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            alert('Webex credentials saved successfully!');
            loadConfig();
        } else {
            alert('Failed to save credentials - server returned error');
        }
    } catch (error) {
        console.error('Error saving credentials:', error);
        alert('Failed to save credentials - network error');
    }
}

async function startWebexAuth() {
    try {
        const response = await fetch(API.webexAuth);
        const data = await response.json();

        if (data.auth_url) {
            const redirectField = document.getElementById('webex-redirect-uri');
            const redirectNote = document.getElementById('webex-redirect-note');
            if (redirectField && data.redirect_uri) {
                redirectField.value = data.redirect_uri;
            }
            if (redirectNote && data.redirect_uri) {
                redirectNote.textContent = `Add this redirect URI to your Webex Integration: ${data.redirect_uri}`;
            }
            window.open(data.auth_url, '_blank');
        } else {
            alert(data.error || 'Failed to get authorization URL');
        }
    } catch (error) {
        alert('Failed to start authorization');
    }
}

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

async function saveXAPIConfig(e) {
    e.preventDefault();

    const data = {
        xapi_device_id: document.getElementById('xapi-device-id').value
    };

    try {
        await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('xAPI device saved!');
    } catch (error) {
        alert('Failed to save xAPI config');
    }
}

// MQTT Functions
async function saveMQTTConfig(e) {
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
    
    // Only include password if user entered a new one
    // If empty, backend will keep existing password
    if (password) {
        data.mqtt_password = password;
    }

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            alert('MQTT configuration saved successfully!');
            loadConfig();
        } else {
            alert('Failed to save MQTT config - server returned error');
        }
    } catch (error) {
        console.error('Error saving MQTT config:', error);
        alert('Failed to save MQTT config - network error');
    }
}

// Display Functions
async function saveDisplaySettings(e) {
    e.preventDefault();

    const data = {
        display_name: document.getElementById('display-name').value,
        brightness: parseInt(document.getElementById('brightness').value),
        poll_interval: parseInt(document.getElementById('poll-interval').value),
        scroll_speed_ms: parseInt(document.getElementById('scroll-speed').value),
        time_format: document.getElementById('time-format').value,
        date_format: document.getElementById('date-format').value,
        time_zone: document.getElementById('time-zone').value,
        ntp_server: document.getElementById('ntp-server').value.trim() || 'pool.ntp.org'
    };

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error('Save failed');
        }
        alert('Display settings saved!');
        await loadConfig();
    } catch (error) {
        alert('Failed to save display settings');
    }
}

async function saveTimeSettings(e) {
    e.preventDefault();

    const data = {
        time_format: document.getElementById('time-format').value,
        date_format: document.getElementById('date-format').value,
        time_zone: document.getElementById('time-zone').value,
        ntp_server: document.getElementById('ntp-server').value.trim() || 'pool.ntp.org'
    };

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error('Save failed');
        }
        alert('Time settings saved!');
        await loadConfig();
    } catch (error) {
        alert('Failed to save time settings');
    }
}

async function saveOTASettings(e) {
    e.preventDefault();

    const data = {
        ota_url: document.getElementById('ota-url').value.trim(),
        auto_update: document.getElementById('auto-update').checked
    };

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error('Save failed');
        }
        alert('OTA settings saved!');
        await loadConfig();
    } catch (error) {
        alert('Failed to save OTA settings');
    }
}

async function saveDebugSettings(e) {
    e.preventDefault();

    const data = {
        debug_mode: document.getElementById('debug-mode').checked
    };

    try {
        const response = await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error('Save failed');
        }
        alert('Debug settings saved!');
        await loadConfig();
    } catch (error) {
        alert('Failed to save debug settings');
    }
}

// OTA Functions
async function checkForUpdate() {
    const btn = document.getElementById('check-update');
    const latestEl = document.getElementById('latest-version');

    btn.disabled = true;
    btn.textContent = 'Checking...';
    latestEl.textContent = 'Checking...';

    try {
        const response = await fetch(API.otaCheck);
        const data = await response.json();

        latestEl.textContent = data.latest_version || 'Unknown';

        if (data.update_available) {
            document.getElementById('perform-update').disabled = false;
        }
    } catch (error) {
        latestEl.textContent = 'Check failed';
    }

    btn.disabled = false;
    btn.textContent = 'Check for Updates';
}

async function performUpdate() {
    if (!confirm('Are you sure you want to install the update? The device will restart.')) {
        return;
    }

    try {
        await fetch(API.otaUpdate, { method: 'POST' });
        alert('Update started. The device will restart when complete.');
    } catch (error) {
        alert('Failed to start update');
    }
}

function initManualUpload() {
    const fileInput = document.getElementById('ota-file');
    const uploadBtn = document.getElementById('ota-upload-btn');
    const statusEl = document.getElementById('ota-upload-status');

    if (!fileInput || !uploadBtn || !statusEl) {
        return;
    }

    fileInput.addEventListener('change', () => {
        const hasFile = fileInput.files && fileInput.files.length > 0;
        uploadBtn.disabled = !hasFile;
        statusEl.textContent = hasFile ? 'Ready to upload.' : 'Select a firmware file to upload.';
    });

    uploadBtn.addEventListener('click', () => {
        uploadFirmware({ fileInput, uploadBtn, statusEl });
    });
}

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

// System Functions
async function rebootDevice() {
    if (!confirm('Are you sure you want to reboot the device?')) {
        return;
    }

    try {
        await fetch(API.reboot, { method: 'POST' });
        alert('Device is rebooting...');
    } catch (error) {
        alert('Failed to reboot');
    }
}

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

async function factoryReset() {
    if (!confirm('WARNING: This will erase all settings! Are you sure?')) {
        return;
    }
    if (!confirm('This action cannot be undone. Continue?')) {
        return;
    }

    try {
        await fetch(API.factoryReset, { method: 'POST' });
        alert('Factory reset complete. Device is rebooting...');
    } catch (error) {
        alert('Failed to reset');
    }
}

// Utility Functions
function formatBytes(bytes) {
    if (!bytes) return '--';
    const kb = bytes / 1024;
    return kb.toFixed(1) + ' KB';
}

function formatUptime(seconds) {
    if (!seconds) return '--';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}
