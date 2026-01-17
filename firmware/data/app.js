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
    reboot: '/api/reboot',
    factoryReset: '/api/factory-reset'
};

// State
let config = {};
let statusInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadStatus();
    loadConfig();
    initEventListeners();

    // Start status polling
    statusInterval = setInterval(loadStatus, 5000);
});

// Tab Navigation
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;

            // Update active tab button
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show active content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');
        });
    });
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
    // Webex status
    const statusEl = document.getElementById('webex-status');
    statusEl.textContent = data.webex_status || '--';
    statusEl.className = 'value ' + (data.webex_status || '').toLowerCase();

    // Camera/Mic/Call
    document.getElementById('camera-status').textContent = data.camera_on ? 'On' : 'Off';
    document.getElementById('mic-status').textContent = data.mic_muted ? 'Muted' : 'Unmuted';
    document.getElementById('call-status').textContent = data.in_call ? 'Yes' : 'No';

    // Sensors
    if (data.temperature) {
        const tempF = (data.temperature * 9/5) + 32;
        document.getElementById('temperature').textContent = tempF.toFixed(1) + '°F';
    }
    if (data.humidity) {
        document.getElementById('humidity').textContent = data.humidity.toFixed(1) + '%';
    }
    document.getElementById('door-status').textContent = data.door_status || '--';
    document.getElementById('air-quality').textContent = data.air_quality || '--';

    // System info
    document.getElementById('firmware-version').textContent = data.firmware_version || '--';
    document.getElementById('current-version').textContent = data.firmware_version || '--';
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
        document.getElementById('poll-interval').value = config.poll_interval || 30;
        document.getElementById('xapi-device-id').value = config.xapi_device_id || '';
        document.getElementById('mqtt-broker').value = config.mqtt_broker || '';
        document.getElementById('mqtt-port').value = config.mqtt_port || 1883;
        document.getElementById('mqtt-topic').value = config.mqtt_topic || 'meraki/v1/mt/#';
        document.getElementById('sensor-serial').value = config.sensor_serial || '';
        document.getElementById('ota-url').value = config.ota_url || '';
        document.getElementById('auto-update').checked = config.auto_update || false;

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

    // WiFi scan
    document.getElementById('scan-wifi').addEventListener('click', scanWifi);

    // WiFi form
    document.getElementById('wifi-form').addEventListener('submit', saveWifi);

    // Webex form
    document.getElementById('webex-form').addEventListener('submit', saveWebexCredentials);

    // Webex auth button
    document.getElementById('webex-auth-btn').addEventListener('click', startWebexAuth);

    // xAPI form
    document.getElementById('xapi-form').addEventListener('submit', saveXAPIConfig);

    // MQTT form
    document.getElementById('mqtt-form').addEventListener('submit', saveMQTTConfig);

    // Display form
    document.getElementById('display-form').addEventListener('submit', saveDisplaySettings);

    // OTA buttons
    document.getElementById('check-update').addEventListener('click', checkForUpdate);
    document.getElementById('perform-update').addEventListener('click', performUpdate);

    // System buttons
    document.getElementById('reboot-btn').addEventListener('click', rebootDevice);
    document.getElementById('factory-reset-btn').addEventListener('click', factoryReset);
}

// WiFi Functions
async function scanWifi() {
    const btn = document.getElementById('scan-wifi');
    const listEl = document.getElementById('wifi-networks');

    btn.disabled = true;
    btn.textContent = 'Scanning...';
    listEl.innerHTML = '<p>Scanning...</p>';

    try {
        const response = await fetch(API.wifiScan);
        const data = await response.json();

        listEl.innerHTML = '';
        data.networks.forEach(network => {
            const item = document.createElement('div');
            item.className = 'network-item';
            item.innerHTML = `
                <span class="ssid">${network.ssid}</span>
                <span class="signal">${network.rssi} dBm ${network.encrypted ? '🔒' : ''}</span>
            `;
            item.addEventListener('click', () => {
                document.getElementById('wifi-ssid').value = network.ssid;
            });
            listEl.appendChild(item);
        });
    } catch (error) {
        listEl.innerHTML = '<p>Scan failed</p>';
    }

    btn.disabled = false;
    btn.textContent = 'Scan Networks';
}

async function saveWifi(e) {
    e.preventDefault();

    const formData = new FormData(e.target);

    try {
        const response = await fetch(API.wifiSave, {
            method: 'POST',
            body: formData
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

    const data = {
        webex_client_id: document.getElementById('webex-client-id').value,
        webex_client_secret: document.getElementById('webex-client-secret').value
    };

    try {
        await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('Webex credentials saved!');
        loadConfig();
    } catch (error) {
        alert('Failed to save credentials');
    }
}

async function startWebexAuth() {
    try {
        const response = await fetch(API.webexAuth);
        const data = await response.json();

        if (data.auth_url) {
            window.open(data.auth_url, '_blank');
        } else {
            alert('Failed to get authorization URL');
        }
    } catch (error) {
        alert('Failed to start authorization');
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

    const data = {
        mqtt_broker: document.getElementById('mqtt-broker').value,
        mqtt_port: parseInt(document.getElementById('mqtt-port').value),
        mqtt_username: document.getElementById('mqtt-username').value,
        mqtt_password: document.getElementById('mqtt-password').value,
        mqtt_topic: document.getElementById('mqtt-topic').value,
        sensor_serial: document.getElementById('sensor-serial').value
    };

    try {
        await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('MQTT configuration saved!');
    } catch (error) {
        alert('Failed to save MQTT config');
    }
}

// Display Functions
async function saveDisplaySettings(e) {
    e.preventDefault();

    const data = {
        display_name: document.getElementById('display-name').value,
        brightness: parseInt(document.getElementById('brightness').value),
        poll_interval: parseInt(document.getElementById('poll-interval').value)
    };

    try {
        await fetch(API.config, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('Display settings saved!');
    } catch (error) {
        alert('Failed to save display settings');
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
