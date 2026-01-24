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
const releaseSelect = document.getElementById('release-select');
const refreshReleasesBtn = document.getElementById('refresh-releases-btn');
const manualFileInput = document.getElementById('manual-file');
const manualUploadBtn = document.getElementById('manual-upload-btn');
const manualUploadStatus = document.getElementById('manual-upload-status');

// Status elements
const wifiStatus = document.getElementById('wifi-status');
const ipAddress = document.getElementById('ip-address');
const versionSpan = document.getElementById('version');
const buildIdSpan = document.getElementById('build-id');

// State
let otaInProgress = false;
let manualUploadInProgress = false;
let availableReleases = [];
let isWifiConnected = false;
let statusIntervalId = null;

/**
 * Fetch with timeout guard
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

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
 * Load available firmware releases from GitHub
 */
async function loadReleases() {
    if (manualUploadInProgress) {
        return;
    }
    if (!isWifiConnected) {
        setStatus('ready', 'Connect to WiFi to load versions');
        return;
    }

    setStatus('progress', 'Loading versions from GitHub...');

    try {
        // Increased timeout from 15s to 70s to match backend 60s + overhead
        const response = await fetchWithTimeout('/api/releases', {}, 70000);
        const data = await response.json();

        availableReleases = data.releases || [];

        // Clear and populate select
        releaseSelect.innerHTML = '<option value="-1">Latest Stable (Auto)</option>';

        if (!data.cached && data.error) {
            setStatus('error', data.error);
            return;
        }

        if (availableReleases.length > 0) {
            availableReleases.forEach((release, index) => {
                const option = document.createElement('option');
                option.value = release.index;
                option.textContent = release.version + (release.is_beta ? ' [BETA]' : '');
                if (release.is_beta) {
                    option.style.color = '#f39c12';
                }
                releaseSelect.appendChild(option);
            });
            setStatus('ready', `Found ${data.count} versions`);
        } else if (!data.cached) {
            // Use retry_after_ms from server response if available
            const retryAfter = data.retry_after_ms || 5000;
            setStatus('progress', data.message || 'Fetching releases...');
            // Retry in a few seconds
            setTimeout(loadReleases, retryAfter);
        } else {
            setStatus('ready', 'No releases found - use Latest Stable');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            setStatus('error', 'Release request timed out');
        } else {
            setStatus('error', 'Failed to load versions');
        }
        console.error('Load releases error:', error);
    }
}

/**
 * Start OTA firmware installation
 */
async function startOTA() {
    if (otaInProgress) return;

    installBtn.disabled = true;
    otaInProgress = true;

    const selectedIndex = parseInt(releaseSelect.value);
    setStatus('progress', 'Starting firmware download...');
    setProgress(0);

    try {
        let response;

        if (selectedIndex >= 0) {
            // Install specific release
            response = await fetch('/api/install-release', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index: selectedIndex })
            });
        } else {
            // Install latest stable
            response = await fetch('/api/start-ota', { method: 'POST' });
        }

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
    if (manualUploadInProgress) {
        return;
    }
    try {
        const response = await fetchWithTimeout('/api/status', {}, 8000);
        const data = await response.json();

        wifiStatus.textContent = data.wifi_connected ? 'Connected' : 'Disconnected';
        wifiStatus.style.color = data.wifi_connected ? '#27ae60' : '#e74c3c';
        isWifiConnected = !!data.wifi_connected;

        ipAddress.textContent = data.ip_address || '--';

        versionSpan.textContent = data.version || '--';
        buildIdSpan.textContent = data.build || '--';

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
if (refreshReleasesBtn) {
    refreshReleasesBtn.addEventListener('click', loadReleases);
}
if (manualFileInput && manualUploadBtn && manualUploadStatus) {
    manualFileInput.addEventListener('change', () => {
        const hasFile = manualFileInput.files && manualFileInput.files.length > 0;
        manualUploadBtn.disabled = !hasFile;
        manualUploadStatus.textContent = hasFile ? 'Ready to upload.' : 'Select a firmware file to upload.';
    });
    manualUploadBtn.addEventListener('click', startManualUpload);
}

// Initial status load
updateStatus();

// Load releases after a short delay (give device time to fetch from GitHub)
setTimeout(loadReleases, 2000);

// Poll status every 5 seconds
statusIntervalId = setInterval(updateStatus, 5000);

/**
 * Manual firmware upload
 */
async function startManualUpload() {
    if (!manualFileInput.files || manualFileInput.files.length === 0) {
        manualUploadStatus.textContent = 'No file selected.';
        return;
    }

    const file = manualFileInput.files[0];

    if (!confirm('Upload firmware file? The device will restart when complete.')) {
        return;
    }

    const uploadUrl = new URL('/api/ota/upload', window.location.href);
    const pingUrl = new URL('/api/ota/ping', window.location.href);
    const formData = new FormData();
    formData.append('firmware', file, file.name);

    manualUploadBtn.disabled = true;
    manualUploadStatus.textContent = `Connecting to ${uploadUrl.host}...`;

    try {
        const pingResponse = await fetch(pingUrl.toString(), { cache: 'no-store' });
        if (!pingResponse.ok) {
            manualUploadStatus.textContent = 'Upload endpoint not reachable.';
            manualUploadBtn.disabled = false;
            return;
        }
        const pingData = await pingResponse.json().catch(() => null);
        if (!pingData || !pingData.ok) {
            manualUploadStatus.textContent = 'Upload endpoint not ready.';
            manualUploadBtn.disabled = false;
            return;
        }
    } catch (error) {
        manualUploadStatus.textContent = 'Upload endpoint not reachable.';
        manualUploadBtn.disabled = false;
        return;
    }

    manualUploadStatus.textContent = 'Uploading...';
    manualUploadInProgress = true;
    if (statusIntervalId) {
        clearInterval(statusIntervalId);
        statusIntervalId = null;
    }
    if (refreshReleasesBtn) {
        refreshReleasesBtn.disabled = true;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl.toString());
    xhr.timeout = 120000;

    xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
            return;
        }
        const percent = Math.round((event.loaded / event.total) * 100);
        manualUploadStatus.textContent = `Uploading... ${percent}%`;
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
                console.error('Manual upload response parse failed:', error);
            }
        }
        manualUploadStatus.textContent = message;
        if (!wasSuccessful) {
            manualUploadBtn.disabled = false;
        }
        manualUploadInProgress = false;
        if (!statusIntervalId) {
            statusIntervalId = setInterval(updateStatus, 5000);
        }
        if (refreshReleasesBtn) {
            refreshReleasesBtn.disabled = false;
        }
    };

    xhr.onerror = () => {
        manualUploadStatus.textContent = 'Upload failed. Please try again.';
        manualUploadBtn.disabled = false;
        manualUploadInProgress = false;
        if (!statusIntervalId) {
            statusIntervalId = setInterval(updateStatus, 5000);
        }
        if (refreshReleasesBtn) {
            refreshReleasesBtn.disabled = false;
        }
    };

    xhr.ontimeout = () => {
        manualUploadStatus.textContent = 'Upload timed out. Please try again.';
        manualUploadBtn.disabled = false;
        manualUploadInProgress = false;
        if (!statusIntervalId) {
            statusIntervalId = setInterval(updateStatus, 5000);
        }
        if (refreshReleasesBtn) {
            refreshReleasesBtn.disabled = false;
        }
    };

    xhr.send(formData);
}

