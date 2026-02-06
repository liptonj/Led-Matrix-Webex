/**
 * Shared utilities for Webex Display Configuration UI
 * Used by main UI (app.js)
 */

// ============================================================
// Tab Navigation
// ============================================================
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            showTab(tabId);
        });
    });
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

// ============================================================
// Connection Status Updates
// ============================================================
function updateConnectionItem(id, connected) {
    const el = document.getElementById(id);
    if (!el) return;
    if (connected) {
        el.classList.add('connected');
    } else {
        el.classList.remove('connected');
    }
}

// ============================================================
// Form Utilities
// ============================================================
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

// ============================================================
// WiFi Functions
// ============================================================
async function scanWifi(config) {
    const btn = document.getElementById(config.scanBtnId || 'scan-wifi');
    const listEl = document.getElementById(config.listElId || 'wifi-networks');
    const endpoint = config.endpoint || '/api/wifi/scan';

    btn.disabled = true;
    btn.textContent = 'Scanning...';
    listEl.innerHTML = '<p>Scanning...</p>';

    try {
        // Start the scan
        const startResponse = await fetch(endpoint);
        const startData = await startResponse.json();
        
        // If scan is already complete (results available immediately)
        if (startResponse.status === 200 && startData.networks) {
            displayNetworks(startData.networks, listEl, config);
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
                
                const pollResponse = await fetch(endpoint);
                const pollData = await pollResponse.json();
                
                if (pollResponse.status === 200 && pollData.networks) {
                    displayNetworks(pollData.networks, listEl, config);
                    btn.disabled = false;
                    btn.textContent = 'Scan Networks';
                    return;
                }
            }
            
            // Timeout after 10 seconds
            listEl.innerHTML = '<p>Scan timeout - please try again</p>';
        } else {
            const message = (startData && (startData.error || startData.message)) || 'Scan failed';
            listEl.innerHTML = '<p>' + message + '</p>';
        }
    } catch (error) {
        console.error('WiFi scan error:', error);
        listEl.innerHTML = '<p>Scan failed - ' + error.message + '</p>';
    }

    btn.disabled = false;
    btn.textContent = 'Scan Networks';
}

function displayNetworks(networks, listEl, config) {
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
            const ssidInput = document.getElementById(config.ssidInputId || 'wifi-ssid');
            if (ssidInput) {
                ssidInput.value = network.ssid;
            }
        });
        listEl.appendChild(item);
    });
}

async function saveWifi(config) {
    const ssidRaw = document.getElementById(config.ssidInputId || 'wifi-ssid').value;
    const passwordRaw = document.getElementById(config.passwordInputId || 'wifi-password').value;
    const ssid = ssidRaw.replace(/[\r\n\t]/g, '').trim();
    const password = passwordRaw.replace(/[\r\n\t]/g, '');
    const endpoint = config.endpoint || '/api/wifi/save';

    if (!ssid) {
        alert('SSID required');
        return;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password })
        });
        const data = await response.json();
        alert(data.message || 'WiFi saved!');
        if (config.onSuccess) {
            config.onSuccess();
        }
    } catch (error) {
        alert('Failed to save WiFi settings');
        console.error('WiFi save error:', error);
    }
}

// ============================================================
// Webex Functions
// ============================================================
async function startWebexAuth(config) {
    const endpoint = config.endpoint || '/api/webex/auth';
    try {
        const response = await fetch(endpoint);
        const data = await response.json();

        if (data.auth_url) {
            window.open(data.auth_url, '_blank');
            if (config.onSuccess) {
                config.onSuccess(data);
            }
        } else {
            alert(data.error || 'Failed to get authorization URL');
        }
    } catch (error) {
        alert('Failed to start authorization');
        console.error('Webex auth error:', error);
    }
}

// ============================================================
// OTA Functions
// ============================================================
async function checkForUpdate(config) {
    const btn = document.getElementById(config.btnId || 'check-update');
    const latestEl = document.getElementById(config.latestElId || 'latest-version');
    const updateBtn = document.getElementById(config.updateBtnId || 'perform-update');
    const endpoint = config.endpoint || '/api/ota/check';

    btn.disabled = true;
    btn.textContent = 'Checking...';
    latestEl.textContent = 'Checking...';

    try {
        const response = await fetch(endpoint);
        const data = await response.json();

        latestEl.textContent = data.latest_version || 'Unknown';

        if (data.update_available && updateBtn) {
            updateBtn.disabled = false;
        }
        
        if (config.onSuccess) {
            config.onSuccess(data);
        }
    } catch (error) {
        latestEl.textContent = 'Check failed';
        console.error('OTA check error:', error);
    }

    btn.disabled = false;
    btn.textContent = 'Check for Updates';
}

async function performUpdate(config) {
    if (!confirm('Are you sure you want to install the update? The device will restart.')) {
        return;
    }

    const endpoint = config.endpoint || '/api/ota/update';

    try {
        await fetch(endpoint, { method: 'POST' });
        alert('Update started. The device will restart when complete.');
        if (config.onSuccess) {
            config.onSuccess();
        }
    } catch (error) {
        alert('Failed to start update');
        console.error('OTA update error:', error);
    }
}

// ============================================================
// System Functions
// ============================================================
async function rebootDevice(config) {
    if (!confirm('Are you sure you want to reboot the device?')) {
        return;
    }

    const endpoint = config.endpoint || '/api/reboot';

    try {
        await fetch(endpoint, { method: 'POST' });
        alert('Device is rebooting...');
        if (config.onSuccess) {
            config.onSuccess();
        }
    } catch (error) {
        alert('Failed to reboot');
        console.error('Reboot error:', error);
    }
}

async function factoryReset(config) {
    if (!confirm('WARNING: This will erase all settings! Are you sure?')) {
        return;
    }
    if (!confirm('This action cannot be undone. Continue?')) {
        return;
    }

    const endpoint = config.endpoint || '/api/factory-reset';

    try {
        await fetch(endpoint, { method: 'POST' });
        alert('Factory reset complete. Device is rebooting...');
        if (config.onSuccess) {
            config.onSuccess();
        }
    } catch (error) {
        alert('Failed to reset');
        console.error('Factory reset error:', error);
    }
}

// ============================================================
// Config Save Function
// ============================================================
async function saveConfig(data, config) {
    const endpoint = config.endpoint || '/api/config';
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            if (config.successMessage !== false) {
                alert(config.successMessage || 'Configuration saved!');
            }
            if (config.onSuccess) {
                await config.onSuccess();
            }
            return true;
        } else {
            throw new Error('Save failed');
        }
    } catch (error) {
        if (config.errorMessage !== false) {
            alert(config.errorMessage || 'Failed to save configuration');
        }
        console.error('Config save error:', error);
        return false;
    }
}

// ============================================================
// Data Constants
// ============================================================
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

// ============================================================
// UI Helper Functions
// ============================================================
function populateSelectOptions(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '';
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
    });
}

function initPasswordToggle(inputId, toggleId, defaultVisible = false) {
    const passwordInput = document.getElementById(inputId);
    const toggle = document.getElementById(toggleId);
    if (!passwordInput || !toggle) return;
    
    toggle.addEventListener('change', () => {
        passwordInput.type = toggle.checked ? 'text' : 'password';
    });
    
    if (defaultVisible) {
        toggle.checked = true;
        passwordInput.type = 'text';
    }
}

function initFileUpload(config) {
    const fileInput = document.getElementById(config.fileInputId);
    const uploadBtn = document.getElementById(config.uploadBtnId);
    const statusEl = document.getElementById(config.statusElId);
    
    if (!fileInput || !uploadBtn || !statusEl) return;
    
    fileInput.addEventListener('change', () => {
        const hasFile = fileInput.files && fileInput.files.length > 0;
        uploadBtn.disabled = !hasFile;
        statusEl.textContent = hasFile ? 'Ready to upload.' : 'Select a file to upload.';
    });
    
    uploadBtn.addEventListener('click', () => {
        if (config.onUpload) {
            config.onUpload({ fileInput, uploadBtn, statusEl });
        }
    });
}

// ============================================================
// Utility Functions
// ============================================================
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

async function fetchWithTimeout(url, options, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// ============================================================
// Export for module systems (if needed)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TIME_ZONES,
        initTabs,
        showTab,
        updateConnectionItem,
        ensureSelectOption,
        populateSelectOptions,
        initPasswordToggle,
        initFileUpload,
        scanWifi,
        displayNetworks,
        saveWifi,
        startWebexAuth,
        checkForUpdate,
        performUpdate,
        rebootDevice,
        factoryReset,
        saveConfig,
        formatBytes,
        formatUptime,
        fetchWithTimeout
    };
}
