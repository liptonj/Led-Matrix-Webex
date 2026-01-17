/**
 * Bootstrap Firmware - Setup Page JavaScript
 */

// DOM Elements
const scanBtn = document.getElementById('scan-btn');
const networksDiv = document.getElementById('networks');
const wifiForm = document.getElementById('wifi-form');
const ssidInput = document.getElementById('ssid');
const passwordInput = document.getElementById('password');
const installBtn = document.getElementById('install-btn');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const otaUrlInput = document.getElementById('ota-url');
const saveUrlBtn = document.getElementById('save-url-btn');

// Status elements
const wifiStatus = document.getElementById('wifi-status');
const ipAddress = document.getElementById('ip-address');
const smartconfigStatus = document.getElementById('smartconfig-status');
const versionSpan = document.getElementById('version');

// State
let otaInProgress = false;

/**
 * Scan for WiFi networks
 */
async function scanNetworks() {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    networksDiv.innerHTML = '<div class="network">Scanning...</div>';
    
    try {
        const response = await fetch('/api/scan');
        const data = await response.json();
        
        if (data.networks && data.networks.length > 0) {
            networksDiv.innerHTML = data.networks.map(network => `
                <div class="network" onclick="selectNetwork('${escapeHtml(network.ssid)}')">
                    <span class="network-ssid">${escapeHtml(network.ssid)}</span>
                    <span class="network-info">${network.rssi} dBm ${network.encrypted ? '🔒' : ''}</span>
                </div>
            `).join('');
        } else {
            networksDiv.innerHTML = '<div class="network">No networks found</div>';
        }
    } catch (error) {
        networksDiv.innerHTML = '<div class="network">Scan failed. Try again.</div>';
        console.error('Scan error:', error);
    }
    
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan Networks';
}

/**
 * Select a network from the list
 */
function selectNetwork(ssid) {
    ssidInput.value = ssid;
    passwordInput.focus();
}

/**
 * Save WiFi credentials
 */
async function saveWifi(event) {
    event.preventDefault();
    
    const ssid = ssidInput.value.trim();
    const password = passwordInput.value;
    
    if (!ssid) {
        alert('Please enter a network name');
        return;
    }
    
    const submitBtn = wifiForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connecting...';
    
    try {
        const response = await fetch('/api/wifi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message || 'WiFi credentials saved. Connecting...');
            // Start polling for connection status
            setTimeout(updateStatus, 2000);
        } else {
            alert(data.error || 'Failed to save WiFi credentials');
        }
    } catch (error) {
        alert('Connection error. Please try again.');
        console.error('WiFi save error:', error);
    }
    
    submitBtn.disabled = false;
    submitBtn.textContent = 'Connect to WiFi';
}

/**
 * Start OTA firmware installation
 */
async function startOTA() {
    if (otaInProgress) return;
    
    installBtn.disabled = true;
    otaInProgress = true;
    
    setStatus('progress', 'Starting firmware download...');
    setProgress(0);
    
    try {
        const response = await fetch('/api/start-ota', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            pollOTAProgress();
        } else {
            setStatus('error', data.error || 'Failed to start update');
            installBtn.disabled = false;
            otaInProgress = false;
        }
    } catch (error) {
        setStatus('error', 'Connection error');
        installBtn.disabled = false;
        otaInProgress = false;
        console.error('OTA start error:', error);
    }
}

/**
 * Poll OTA progress
 */
async function pollOTAProgress() {
    try {
        const response = await fetch('/api/ota-progress');
        const data = await response.json();
        
        setProgress(data.progress || 0);
        
        if (data.status === 'success') {
            setStatus('success', 'Update complete! Rebooting...');
            return;
        } else if (data.status === 'error') {
            setStatus('error', data.message || 'Update failed');
            installBtn.disabled = false;
            otaInProgress = false;
            return;
        } else {
            setStatus('progress', data.message || 'Updating...');
            setTimeout(pollOTAProgress, 500);
        }
    } catch (error) {
        // Device may have rebooted
        setStatus('success', 'Device rebooting...');
        console.log('Progress poll ended (device may be rebooting)');
    }
}

/**
 * Save custom OTA URL
 */
async function saveOTAUrl() {
    const url = otaUrlInput.value.trim();
    
    try {
        const response = await fetch('/api/ota-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        const data = await response.json();
        alert(data.message || 'URL saved');
    } catch (error) {
        alert('Failed to save URL');
        console.error('OTA URL save error:', error);
    }
}

/**
 * Update device status display
 */
async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        wifiStatus.textContent = data.wifi_connected ? 'Connected' : 'Disconnected';
        wifiStatus.style.color = data.wifi_connected ? '#27ae60' : '#e74c3c';
        
        ipAddress.textContent = data.ip_address || '--';
        
        smartconfigStatus.textContent = data.smartconfig_active ? 'Listening' : 'Inactive';
        smartconfigStatus.style.color = data.smartconfig_active ? '#f39c12' : '#888';
        
        versionSpan.textContent = data.version || '--';
        
        // Enable install button only when WiFi is connected
        if (data.wifi_connected && !otaInProgress) {
            installBtn.disabled = false;
        }
    } catch (error) {
        console.error('Status update error:', error);
    }
}

/**
 * Set status display
 */
function setStatus(type, message) {
    statusIcon.className = 'status-icon ' + type;
    statusText.textContent = message;
}

/**
 * Set progress bar
 */
function setProgress(percent) {
    progressBar.style.width = percent + '%';
    progressText.textContent = percent + '%';
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners
scanBtn.addEventListener('click', scanNetworks);
wifiForm.addEventListener('submit', saveWifi);
installBtn.addEventListener('click', startOTA);
saveUrlBtn.addEventListener('click', saveOTAUrl);

// Initial status load
updateStatus();

// Poll status every 5 seconds
setInterval(updateStatus, 5000);
