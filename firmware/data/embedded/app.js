/**
 * LED Matrix Display - Webex Embedded App
 * 
 * Full-featured embedded app with:
 * - Webex SDK integration for meeting detection
 * - Manual status selection
 * - Multi-display sync support
 * - Complete display configuration
 * 
 * Hosted directly on the ESP32 display.
 */

/* global Webex */

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
    localStatusEndpoint: '/api/embedded/status',
    statusEndpoint: '/api/status',
    configEndpoint: '/api/config',
    modulesEndpoint: '/api/modules',
    variantsEndpoint: '/api/modules/variants',
    moduleEnableEndpoint: '/api/modules/enable',
    moduleInstallEndpoint: '/api/modules/install',
    wifiScanEndpoint: '/api/wifi/scan',
    wifiSaveEndpoint: '/api/wifi/save',
    webexAuthEndpoint: '/api/webex/auth',
    otaCheckEndpoint: '/api/ota/check',
    otaUpdateEndpoint: '/api/ota/update',
    rebootEndpoint: '/api/reboot',
    factoryResetEndpoint: '/api/factory-reset',
    displaysStorageKey: 'webex_displays',
    maxLogEntries: 30,
    maxRetries: 3,
    retryDelayMs: 2000,
    meetingCheckInterval: 10000,
    statusPollInterval: 5000
};

// ============================================================
// Application State
// ============================================================
const state = {
    webexApp: null,
    user: null,
    currentStatus: null,
    previousStatus: null,
    isInMeeting: false,
    additionalDisplays: [],
    autoSync: true,
    isInitialized: false,
    lastSyncTime: null,
    localHost: window.location.host,
    meetingCheckTimer: null,
    statusPollTimer: null,
    displayConfig: {},
    modules: [],
    variants: [],
    selectedModules: 0
};

// ============================================================
// Initialization
// ============================================================
async function initializeApp() {
    logActivity('info', 'Initializing Webex Embedded App...');
    
    // Initialize tabs
    initTabs(); // from common.js
    
    // Load stored displays
    loadAdditionalDisplays();
    
    // Start polling display status
    await loadDisplayStatus();
    await loadDisplayConfig();
    await loadModules();
    state.statusPollTimer = setInterval(loadDisplayStatus, CONFIG.statusPollInterval);
    
    try {
        // Check if Webex SDK is available
        if (typeof Webex === 'undefined' || !Webex.Application) {
            throw new Error('Webex SDK not loaded');
        }
        
        state.webexApp = new Webex.Application();
        
        logActivity('info', 'Waiting for Webex connection...');
        await state.webexApp.onReady();
        logActivity('success', 'Connected to Webex');
        
        await getUserContext();
        await startPresenceMonitoring();
        
        updateConnectionStatus('connected');
        state.isInitialized = true;
        
        logActivity('success', 'App ready');
        
    } catch (error) {
        console.error('Webex SDK init failed:', error);
        logActivity('error', `Webex: ${error.message}`);
        updateConnectionStatus('error');
        
        // App still works for configuration even without Webex
        document.getElementById('user-name').textContent = 'Not in Webex';
        document.getElementById('user-status').textContent = 'Configuration mode';
    }
    
    // Setup all event listeners
    setupEventListeners();
}

// Tab Navigation (use common.js)
// initTabs is in common.js

// ============================================================
// Webex SDK Integration
// ============================================================
async function getUserContext() {
    try {
        const context = await state.webexApp.context.getUser();
        const displayName = context.displayName || context.email.split('@')[0];

        // Extract first name from displayName (or use firstName if provided by Webex)
        const firstName = context.firstName || displayName.split(' ')[0];

        state.user = {
            id: context.id,
            email: context.email,
            displayName: displayName,
            firstName: firstName,
            orgId: context.orgId
        };
        updateUserDisplay();
        logActivity('info', `Signed in: ${state.user.displayName}`);
    } catch (error) {
        console.error('Failed to get user context:', error);
        logActivity('error', 'Could not get user info');
        throw error;
    }
}

async function startPresenceMonitoring() {
    logActivity('info', 'Starting meeting detection...');
    
    try {
        await checkMeetingState();
        
        if (state.webexApp.context.on) {
            state.webexApp.context.on('meeting', handleMeetingChange);
        }
        
        state.meetingCheckTimer = setInterval(checkMeetingState, CONFIG.meetingCheckInterval);
        logActivity('success', 'Meeting detection active');
        
    } catch (error) {
        console.error('Meeting monitoring failed:', error);
        logActivity('error', 'Meeting detection unavailable');
    }
    
    setupStatusButtons();
}

async function checkMeetingState() {
    try {
        const meeting = await state.webexApp.context.getMeeting().catch(() => null);
        handleMeetingChange(meeting);
    } catch (error) {
        // Silently handle - meeting detection not critical
    }
}

function handleMeetingChange(meeting) {
    const wasInMeeting = state.isInMeeting;
    state.isInMeeting = meeting && (meeting.state === 'active' || meeting.id);
    
    const meetingStatusEl = document.getElementById('meeting-status');
    
    if (state.isInMeeting) {
        meetingStatusEl.style.display = 'flex';
        if (!wasInMeeting) {
            logActivity('info', 'Meeting detected');
            setStatus('meeting', true);
        }
    } else {
        meetingStatusEl.style.display = 'none';
        if (wasInMeeting) {
            logActivity('info', 'Meeting ended');
        }
    }
}

function setupStatusButtons() {
    const buttons = document.querySelectorAll('.status-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            setStatus(status, false);
            buttons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
}

function setStatus(status, autoDetected = false) {
    updatePresence({
        status: status,
        displayName: state.user?.displayName,
        autoDetected: autoDetected
    });
}

function updatePresence(presence) {
    state.previousStatus = state.currentStatus;
    state.currentStatus = presence.status?.toLowerCase() || 'unknown';
    
    const statusEl = document.getElementById('user-status');
    const avatarEl = document.getElementById('presence-avatar');
    
    statusEl.textContent = formatStatus(state.currentStatus);
    avatarEl.className = 'presence-avatar ' + state.currentStatus;
    
    if (state.previousStatus !== state.currentStatus) {
        logActivity('info', `Status: ${formatStatus(state.currentStatus)}`);
        if (state.autoSync && state.isInitialized) {
            syncStatusToAllDisplays();
        }
    }
}

function formatStatus(status) {
    const map = {
        'active': 'Available', 'available': 'Available',
        'away': 'Away', 'inactive': 'Away',
        'busy': 'In a Call', 'call': 'In a Call', 'meeting': 'In a Call',
        'dnd': 'Do Not Disturb', 'donotdisturb': 'Do Not Disturb',
        'ooo': 'Out of Office', 'outofoffice': 'Out of Office',
        'offline': 'Offline', 'unknown': 'Unknown'
    };
    return map[status?.toLowerCase()] || status || 'Unknown';
}

function mapToDisplayStatus(status) {
    const map = {
        'active': 'active', 'available': 'active',
        'away': 'away', 'inactive': 'away',
        'busy': 'meeting', 'call': 'meeting', 'meeting': 'meeting',
        'dnd': 'dnd', 'donotdisturb': 'dnd',
        'ooo': 'ooo', 'outofoffice': 'ooo',
        'offline': 'offline'
    };
    return map[status?.toLowerCase()] || 'unknown';
}

function updateUserDisplay() {
    if (!state.user) return;
    document.getElementById('user-name').textContent = state.user.displayName;
    document.getElementById('user-initial').textContent = state.user.displayName.charAt(0).toUpperCase();
}

// ============================================================
// Status Sync
// ============================================================
async function syncStatusToAllDisplays() {
    if (!state.currentStatus) return;
    
    const displayStatus = mapToDisplayStatus(state.currentStatus);
    const localResult = await syncStatusToDisplay(null, displayStatus);
    
    const additionalResults = await Promise.allSettled(
        state.additionalDisplays.map(d => syncStatusToDisplay(d.host, displayStatus))
    );
    
    const allSuccessful = localResult && 
        additionalResults.every(r => r.status === 'fulfilled' && r.value);
    
    updateSyncStatus(allSuccessful);
    
    if (allSuccessful) {
        state.lastSyncTime = new Date();
        document.getElementById('last-sync-time').textContent = state.lastSyncTime.toLocaleTimeString();
    }
}

async function syncStatusToDisplay(host, status) {
    const isLocal = host === null;
    const displayName = isLocal ? 'local' : host;
    
    try {
        const url = isLocal 
            ? CONFIG.localStatusEndpoint 
            : `http://${host}/api/embedded/status`;
        
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: status,
                displayName: state.user?.displayName || 'Unknown',
                source: 'embedded-app',
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            logActivity('success', `Synced: ${displayName}`);
            if (!isLocal) updateDisplayItemStatus(host, 'synced');
            return true;
        }
        throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        logActivity('error', `Sync failed: ${displayName}`);
        if (!isLocal) updateDisplayItemStatus(host, 'error');
        return false;
    }
}

function updateSyncStatus(success) {
    const el = document.getElementById('sync-status');
    if (success) {
        el.className = 'sync-status success';
        el.innerHTML = '<span class="icon">✓</span><span class="text">Status synced</span>';
    } else {
        el.className = 'sync-status error';
        el.innerHTML = '<span class="icon">✗</span><span class="text">Sync failed</span>';
    }
}

// ============================================================
// Display Status & Config Loading
// ============================================================
async function loadDisplayStatus() {
    try {
        const response = await fetch(CONFIG.statusEndpoint);
        const data = await response.json();
        
        // Update status tab
        document.getElementById('display-status').textContent = data.webex_status || '--';
        document.getElementById('camera-status').textContent = data.camera_on ? 'On' : 'Off';
        document.getElementById('mic-status').textContent = data.mic_muted ? 'Muted' : 'On';
        document.getElementById('call-status').textContent = data.in_call ? 'Yes' : 'No';
        
        // Sensor data
        if (data.temperature) {
            const tempF = (data.temperature * 9/5) + 32;
            document.getElementById('temperature').textContent = tempF.toFixed(1) + '°F';
            document.getElementById('sensor-temp').textContent = tempF.toFixed(1) + '°F';
        }
        if (data.humidity != null && data.humidity !== undefined) {
            document.getElementById('humidity').textContent = data.humidity.toFixed(1) + '%';
            document.getElementById('sensor-humidity').textContent = data.humidity.toFixed(1) + '%';
        } else {
            document.getElementById('humidity').textContent = '--';
            document.getElementById('sensor-humidity').textContent = '--';
        }
        // Handle air_quality - 0 is a valid value, so check for null/undefined explicitly
        if (data.air_quality != null && data.air_quality !== undefined) {
            document.getElementById('air-quality').textContent = data.air_quality.toString();
            document.getElementById('sensor-aq').textContent = data.air_quality.toString();
        } else {
            document.getElementById('air-quality').textContent = '--';
            document.getElementById('sensor-aq').textContent = '--';
        }
        document.getElementById('door-status').textContent = data.door_status || '--';
        document.getElementById('sensor-door').textContent = data.door_status || '--';
        
        // System info
        document.getElementById('firmware-version').textContent = data.firmware_version || '--';
        document.getElementById('firmware-build-id').textContent = data.firmware_build_id || '--';
        document.getElementById('current-version').textContent = data.firmware_version || '--';
        document.getElementById('current-build-id').textContent = data.firmware_build_id || '--';
        document.getElementById('app-version').textContent = 'v' + (data.firmware_version || '1.1.16');
        document.getElementById('ip-address').textContent = data.ip_address || '--';
        document.getElementById('mac-address').textContent = data.mac_address || '--';
        document.getElementById('display-host').textContent = data.ip_address || state.localHost;
        document.getElementById('free-heap').textContent = formatBytes(data.free_heap);
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        
        // Connection status
        updateConnectionItem('conn-wifi', data.wifi_connected); // from common.js
        updateConnectionItem('conn-webex', data.webex_authenticated); // from common.js
        updateConnectionItem('conn-mqtt', data.mqtt_connected); // from common.js
        
    } catch (error) {
        console.error('Failed to load status:', error);
    }
}

async function loadDisplayConfig() {
    try {
        const response = await fetch(CONFIG.configEndpoint);
        state.displayConfig = await response.json();
        
        // Populate form fields
        document.getElementById('device-name').value = state.displayConfig.device_name || '';
        document.getElementById('display-name').value = state.displayConfig.display_name || '';
        document.getElementById('brightness').value = state.displayConfig.brightness || 128;
        document.getElementById('brightness-value').textContent = state.displayConfig.brightness || 128;
        const displayPagesEl = document.getElementById('display-pages');
        if (displayPagesEl) {
            const pagesValue = state.displayConfig.display_pages ||
                (state.displayConfig.sensor_page_enabled === false ? 'status' : 'rotate');
            displayPagesEl.value = pagesValue;
        }
        const statusLayoutEl = document.getElementById('status-layout');
        if (statusLayoutEl) {
            statusLayoutEl.value = state.displayConfig.status_layout || 'sensors';
        }
        document.getElementById('date-color').value = state.displayConfig.date_color || '#00ffff';
        document.getElementById('time-color').value = state.displayConfig.time_color || '#ffffff';
        document.getElementById('name-color').value = state.displayConfig.name_color || '#ffa500';
        document.getElementById('metric-color').value = state.displayConfig.metric_color || '#00bfff';
        document.getElementById('poll-interval').value = state.displayConfig.poll_interval || 30;
        document.getElementById('xapi-device-id').value = state.displayConfig.xapi_device_id || '';
        document.getElementById('xapi-poll-interval').value = state.displayConfig.xapi_poll_interval || 10;
        document.getElementById('mqtt-broker').value = state.displayConfig.mqtt_broker || '';
        document.getElementById('mqtt-port').value = state.displayConfig.mqtt_port || 1883;
        document.getElementById('mqtt-topic').value = state.displayConfig.mqtt_topic || 'meraki/v1/mt/#';
        document.getElementById('sensor-serial').value = state.displayConfig.sensor_serial || '';
        document.getElementById('ota-url').value = state.displayConfig.ota_url || '';
        document.getElementById('auto-update').checked = state.displayConfig.auto_update || false;
        
        // Show failed OTA version if set (blocks auto-updates)
        const failedOTA = state.displayConfig.failed_ota_version;
        const failedBanner = document.getElementById('failed-ota-banner');
        if (failedOTA && failedBanner) {
            document.getElementById('failed-ota-version').textContent = failedOTA;
            failedBanner.style.display = 'flex';
        } else if (failedBanner) {
            failedBanner.style.display = 'none';
        }
        
        // Auth status - check actual authentication state (Supabase or local)
        const authStatus = document.getElementById('webex-auth-status');
        if (state.webex_authenticated) {
            // Connected via Supabase OAuth or local tokens
            authStatus.textContent = 'Connected';
            authStatus.style.color = '#6cc04a';
        } else if (state.displayConfig.has_webex_credentials) {
            authStatus.textContent = 'Not authorized';
            authStatus.style.color = '#ffcc00';
        } else {
            authStatus.textContent = 'Not configured';
            authStatus.style.color = '#ff5c5c';
        }

        const clientIdMask = document.getElementById('webex-client-id-mask');
        const clientSecretMask = document.getElementById('webex-client-secret-mask');
        const editToggle = document.getElementById('webex-edit-toggle');
        const webexForm = document.getElementById('webex-form');
        if (clientIdMask) {
            clientIdMask.value = state.displayConfig.has_webex_credentials ? 'xxxxxxxx' : 'not set';
        }
        if (clientSecretMask) {
            clientSecretMask.value = state.displayConfig.has_webex_credentials ? 'xxxxxxxx' : 'not set';
        }
        if (editToggle) {
            editToggle.checked = false;
        }
        if (webexForm) {
            webexForm.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Connection status helpers (use common.js)
// updateConnectionItem is in common.js

// ============================================================
// Configuration Forms
// ============================================================
function setupEventListeners() {
    // Brightness slider
    document.getElementById('brightness').addEventListener('input', (e) => {
        document.getElementById('brightness-value').textContent = e.target.value;
    });
    
    // Display settings form
    document.getElementById('display-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            device_name: document.getElementById('device-name').value,
            display_name: document.getElementById('display-name').value,
            brightness: parseInt(document.getElementById('brightness').value),
            display_pages: document.getElementById('display-pages').value,
            status_layout: document.getElementById('status-layout').value,
            sensor_page_enabled: document.getElementById('display-pages').value === 'rotate',
            date_color: document.getElementById('date-color').value,
            time_color: document.getElementById('time-color').value,
            name_color: document.getElementById('name-color').value,
            metric_color: document.getElementById('metric-color').value,
            poll_interval: parseInt(document.getElementById('poll-interval').value)
        });
    });
    
    // Webex credentials form
    document.getElementById('webex-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editToggle = document.getElementById('webex-edit-toggle');
        if (editToggle && !editToggle.checked) {
            logActivity('info', 'No changes to Webex credentials.');
            return;
        }
        const clientId = document.getElementById('webex-client-id').value.trim();
        const clientSecret = document.getElementById('webex-client-secret').value.trim();
        if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
            alert('Both Client ID and Client Secret are required to update credentials.');
            return;
        }
        if (!clientId && !clientSecret) {
            alert('Please enter both Client ID and Client Secret.');
            return;
        }
        await saveConfig({
            webex_client_id: clientId,
            webex_client_secret: clientSecret
        });
    });
    
    // Webex auth button
    document.getElementById('webex-auth-btn').addEventListener('click', startWebexAuth);

    const webexEditToggle = document.getElementById('webex-edit-toggle');
    const webexForm = document.getElementById('webex-form');
    if (webexEditToggle && webexForm) {
        webexEditToggle.addEventListener('change', () => {
            webexForm.style.display = webexEditToggle.checked ? 'block' : 'none';
        });
    }
    
    // xAPI form
    document.getElementById('xapi-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            xapi_device_id: document.getElementById('xapi-device-id').value,
            xapi_poll_interval: parseInt(document.getElementById('xapi-poll-interval').value)
        });
    });
    
    // MQTT form
    document.getElementById('mqtt-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            mqtt_broker: document.getElementById('mqtt-broker').value,
            mqtt_port: parseInt(document.getElementById('mqtt-port').value),
            mqtt_username: document.getElementById('mqtt-username').value,
            mqtt_password: document.getElementById('mqtt-password').value,
            mqtt_topic: document.getElementById('mqtt-topic').value,
            sensor_serial: document.getElementById('sensor-serial').value
        });
    });
    
    // WiFi scan
    document.getElementById('scan-wifi').addEventListener('click', () => {
        scanWifi({ // from common.js
            scanBtnId: 'scan-wifi',
            listElId: 'wifi-networks',
            ssidInputId: 'wifi-ssid',
            endpoint: CONFIG.wifiScanEndpoint
        });
    });
    
    // WiFi form
    document.getElementById('wifi-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveWifi({ // from common.js
            ssidInputId: 'wifi-ssid',
            passwordInputId: 'wifi-password',
            endpoint: CONFIG.wifiSaveEndpoint,
            onSuccess: () => {
                logActivity('success', 'WiFi saved - rebooting...');
            }
        });
    });
    
    // OTA form and buttons
    document.getElementById('ota-form').addEventListener('submit', saveOTASettings);
    document.getElementById('check-update').addEventListener('click', () => {
        checkForUpdate({ // from common.js
            btnId: 'check-update',
            latestElId: 'latest-version',
            updateBtnId: 'perform-update',
            endpoint: CONFIG.otaCheckEndpoint,
            onSuccess: (data) => {
                if (data.update_available) {
                    logActivity('info', 'Update available!');
                }
            }
        });
    });
    document.getElementById('perform-update').addEventListener('click', () => {
        performUpdate({ // from common.js
            endpoint: CONFIG.otaUpdateEndpoint,
            onSuccess: () => {
                logActivity('info', 'Update started...');
            }
        });
    });
    
    // Clear failed OTA button
    const clearFailedBtn = document.getElementById('clear-failed-ota');
    if (clearFailedBtn) {
        clearFailedBtn.addEventListener('click', clearFailedOTA);
    }
    
    // System buttons
    document.getElementById('reboot-btn').addEventListener('click', () => {
        rebootDevice({ // from common.js
            endpoint: CONFIG.rebootEndpoint,
            onSuccess: () => {
                logActivity('info', 'Rebooting...');
            }
        });
    });
    document.getElementById('factory-reset-btn').addEventListener('click', () => {
        factoryReset({ // from common.js
            endpoint: CONFIG.factoryResetEndpoint,
            onSuccess: () => {
                logActivity('info', 'Factory reset...');
            }
        });
    });
    
    // Auto-sync toggle
    document.getElementById('auto-sync').addEventListener('change', (e) => {
        state.autoSync = e.target.checked;
        logActivity('info', state.autoSync ? 'Auto-sync enabled' : 'Auto-sync disabled');
    });
    
    // Additional displays
    document.getElementById('add-display').addEventListener('click', () => {
        document.getElementById('add-display-form').style.display = 'block';
        document.getElementById('new-display-host').focus();
    });
    
    document.getElementById('cancel-add-display').addEventListener('click', () => {
        document.getElementById('add-display-form').style.display = 'none';
        document.getElementById('new-display-host').value = '';
    });
    
    document.getElementById('save-display').addEventListener('click', () => {
        const host = document.getElementById('new-display-host').value;
        if (addDisplay(host)) {
            document.getElementById('add-display-form').style.display = 'none';
            document.getElementById('new-display-host').value = '';
        }
    });
    
    document.getElementById('new-display-host').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('save-display').click();
        }
    });
}

// Configuration save (use common.js wrapper)
async function saveConfig(data) {
    try {
        const response = await fetch(CONFIG.configEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (response.ok) {
            logActivity('success', 'Configuration saved');
            await loadDisplayConfig();
        } else {
            throw new Error('Save failed');
        }
    } catch (error) {
        logActivity('error', 'Failed to save config');
    }
}

// Webex auth (use common.js wrapper)
async function startWebexAuth() {
    try {
        const response = await fetch(CONFIG.webexAuthEndpoint);
        const data = await response.json();
        if (data.auth_url) {
            window.open(data.auth_url, '_blank');
            logActivity('info', 'Opened Webex authorization');
        }
    } catch (error) {
        logActivity('error', 'Failed to start auth');
    }
}

// WiFi functions (removed - use common.js)

// OTA and system functions (removed - use common.js)

async function saveOTASettings(e) {
    e.preventDefault();

    const data = {
        ota_url: document.getElementById('ota-url').value.trim(),
        auto_update: document.getElementById('auto-update').checked
    };

    try {
        const response = await fetch(CONFIG.configEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error('Save failed');
        }
        logActivity('success', 'OTA settings saved');
        await loadDisplayConfig();
    } catch (error) {
        logActivity('error', 'Failed to save OTA settings');
    }
}

async function clearFailedOTA() {
    try {
        const response = await fetch(CONFIG.configEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear_failed_ota: true })
        });
        
        if (response.ok) {
            logActivity('success', 'Cleared failed OTA marker - auto-updates will retry');
            document.getElementById('failed-ota-banner').style.display = 'none';
            // Trigger a check for updates
            await checkForUpdate();
        } else {
            throw new Error('Failed to clear');
        }
    } catch (error) {
        logActivity('error', 'Failed to clear OTA marker');
    }
}

// ============================================================
// Module Management
// ============================================================
async function loadModules() {
    try {
        // Load modules info
        const modulesRes = await fetch(CONFIG.modulesEndpoint);
        const modulesData = await modulesRes.json();
        state.modules = modulesData.modules || [];
        state.selectedModules = modulesData.enabled_modules || 0;
        
        document.getElementById('current-variant').textContent = modulesData.current_variant || 'unknown';
        
        // Load variants info
        const variantsRes = await fetch(CONFIG.variantsEndpoint);
        const variantsData = await variantsRes.json();
        state.variants = variantsData.variants || [];
        
        renderModulesList();
        renderVariantsList(variantsData.recommended);
        renderModuleSelector();
        
    } catch (error) {
        console.error('Failed to load modules:', error);
        logActivity('error', 'Failed to load modules');
    }
}

function renderModulesList() {
    const listEl = document.getElementById('modules-list');
    
    if (!state.modules.length) {
        listEl.innerHTML = '<p class="help-text">No module information available</p>';
        return;
    }
    
    listEl.innerHTML = state.modules.map(mod => {
        const installedClass = mod.installed ? 'installed' : 'not-installed';
        const badge = mod.installed 
            ? '<span class="badge badge-installed">Installed</span>'
            : '<span class="badge badge-not-installed">Not Installed</span>';
        
        return `
            <div class="module-item ${installedClass}" data-module-id="${mod.id}">
                <div class="module-info">
                    <div class="module-name">${mod.name} ${badge}</div>
                    <div class="module-desc">${mod.description}</div>
                    <div class="module-size">v${mod.version} • ${mod.size_kb} KB</div>
                </div>
                ${mod.installed && mod.id !== 1 ? `
                    <div class="module-actions">
                        <div class="module-toggle ${mod.enabled ? 'enabled' : ''}" 
                             data-module-id="${mod.id}" 
                             title="${mod.enabled ? 'Disable' : 'Enable'}"></div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    // Add toggle listeners
    listEl.querySelectorAll('.module-toggle').forEach(toggle => {
        toggle.addEventListener('click', async () => {
            const moduleId = parseInt(toggle.dataset.moduleId);
            const isEnabled = toggle.classList.contains('enabled');
            await setModuleEnabled(moduleId, !isEnabled);
        });
    });
}

function renderVariantsList(recommended) {
    const listEl = document.getElementById('variants-list');
    
    if (!state.variants.length) {
        listEl.innerHTML = '<p class="help-text">No variants available</p>';
        return;
    }
    
    // Find current variant for download size estimation
    const currentVariant = state.variants.find(v => v.is_current);
    const currentModules = currentVariant ? currentVariant.modules : 0x01;
    
    listEl.innerHTML = state.variants.map(v => {
        const isCurrent = v.is_current;
        const isRecommended = v.name === recommended;
        let badges = '';
        if (isCurrent) badges += '<span class="badge badge-current">Current</span> ';
        if (isRecommended && !isCurrent) badges += '<span class="badge badge-recommended">Recommended</span>';
        
        // Estimate download size
        const downloadInfo = estimateDownloadSize(currentModules, v.modules, v.size_kb);
        const sizeClass = downloadInfo.size < 50 ? 'small' : downloadInfo.size < 150 ? 'medium' : 'large';
        
        return `
            <div class="variant-item ${isCurrent ? 'current' : ''} ${isRecommended ? 'recommended' : ''}" data-variant="${v.name}">
                <div class="variant-info">
                    <div class="variant-name">${v.name} ${badges}</div>
                    <div class="variant-desc">${v.description}</div>
                    <div class="variant-size">
                        ${v.size_kb} KB total
                        ${!isCurrent ? `<span class="download-size ${sizeClass}">↓ ~${downloadInfo.size} KB ${downloadInfo.method}</span>` : ''}
                    </div>
                </div>
                <div class="variant-actions">
                    ${!isCurrent ? `<button class="btn btn-primary install-variant" data-variant="${v.name}" data-size="${downloadInfo.size}">Install</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Add install listeners
    listEl.querySelectorAll('.install-variant').forEach(btn => {
        btn.addEventListener('click', async () => {
            const variant = btn.dataset.variant;
            if (confirm(`Install "${variant}" firmware? This will reboot the device.`)) {
                await installVariant(variant);
            }
        });
    });
}

function renderModuleSelector() {
    const selectorEl = document.getElementById('module-selector');
    
    // Only show non-core modules
    const selectableModules = state.modules.filter(m => m.id !== 1);
    
    selectorEl.innerHTML = selectableModules.map(mod => {
        const isSelected = (state.selectedModules & mod.id) !== 0;
        return `
            <label class="module-checkbox">
                <input type="checkbox" data-module-id="${mod.id}" ${isSelected ? 'checked' : ''}>
                <span class="label">${mod.name}</span>
                <span class="size">${mod.size_kb} KB</span>
            </label>
        `;
    }).join('');
    
    // Add change listeners
    selectorEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            updateSelectedModules();
        });
    });
    
    updateRecommendedVariant();
}

function updateSelectedModules() {
    const selectorEl = document.getElementById('module-selector');
    let selected = 1; // Core is always selected
    
    selectorEl.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        selected |= parseInt(cb.dataset.moduleId);
    });
    
    state.selectedModules = selected;
    updateRecommendedVariant();
}

function updateRecommendedVariant() {
    const recommendedEl = document.getElementById('recommended-variant');
    const nameEl = document.getElementById('recommended-name');
    
    // Find best matching variant
    let bestVariant = null;
    let bestSize = Infinity;
    
    for (const v of state.variants) {
        if ((v.modules & state.selectedModules) === state.selectedModules) {
            if (v.size_kb < bestSize) {
                bestVariant = v;
                bestSize = v.size_kb;
            }
        }
    }
    
    if (bestVariant && !bestVariant.is_current) {
        nameEl.textContent = `${bestVariant.name} (${bestVariant.size_kb} KB)`;
        recommendedEl.style.display = 'block';
        
        document.getElementById('install-recommended').onclick = async () => {
            if (confirm(`Install "${bestVariant.name}" firmware?`)) {
                await installVariant(bestVariant.name);
            }
        };
    } else {
        recommendedEl.style.display = 'none';
    }
}

async function setModuleEnabled(moduleId, enabled) {
    try {
        const response = await fetch(CONFIG.moduleEnableEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ module_id: moduleId, enabled: enabled })
        });
        
        const data = await response.json();
        
        if (data.success) {
            logActivity('success', `Module ${enabled ? 'enabled' : 'disabled'}`);
            await loadModules(); // Refresh
            
            if (data.variant_change_suggested) {
                logActivity('info', `Consider installing "${data.recommended_variant}" variant`);
            }
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        logActivity('error', `Failed to update module: ${error.message}`);
    }
}

async function installVariant(variantName) {
    try {
        logActivity('info', `Installing ${variantName}...`);
        
        const response = await fetch(CONFIG.moduleInstallEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variant: variantName })
        });
        
        const data = await response.json();
        
        if (data.success) {
            logActivity('success', `OTA update started: ${data.filename}`);
            logActivity('info', 'Device will reboot when complete...');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        logActivity('error', `Install failed: ${error.message}`);
    }
}

/**
 * Estimate download size based on module changes
 * Returns estimated KB and update method
 */
function estimateDownloadSize(fromModules, toModules, fullSizeKb) {
    // Module sizes in KB (approximate)
    const MODULE_SIZES = {
        0x01: 180,  // Core
        0x02: 35,   // Webex Polling
        0x04: 25,   // MQTT Sensors
        0x08: 20,   // Bridge Client
        0x10: 30,   // xAPI Client
        0x20: 45    // Embedded App
    };
    
    const addedModules = toModules & ~fromModules;
    const removedModules = fromModules & ~toModules;
    
    // If delta OTA is available, estimate patch size
    // For now, we use compressed full image estimation
    
    if (addedModules === 0 && removedModules === 0) {
        // Same modules, version update only
        return { size: Math.round(fullSizeKb * 0.1), method: '(patch)' };
    }
    
    // Calculate delta size
    let deltaSize = 10;  // Base overhead
    
    for (let bit = 0x01; bit <= 0x20; bit <<= 1) {
        if (addedModules & bit) {
            deltaSize += Math.round((MODULE_SIZES[bit] || 20) * 0.8);
        }
        if (removedModules & bit) {
            deltaSize += Math.round((MODULE_SIZES[bit] || 20) * 0.1);
        }
    }
    
    // Compare with compressed full image (~60% of full)
    const compressedSize = Math.round(fullSizeKb * 0.6);
    
    if (deltaSize < compressedSize) {
        return { size: deltaSize, method: '(delta)' };
    } else {
        return { size: compressedSize, method: '(compressed)' };
    }
}

// ============================================================
// Additional Displays
// ============================================================
function loadAdditionalDisplays() {
    try {
        const stored = localStorage.getItem(CONFIG.displaysStorageKey);
        if (stored) {
            state.additionalDisplays = JSON.parse(stored);
            renderDisplaysList();
        }
    } catch (error) {
        state.additionalDisplays = [];
    }
}

function saveAdditionalDisplays() {
    try {
        localStorage.setItem(CONFIG.displaysStorageKey, JSON.stringify(state.additionalDisplays));
    } catch (error) {
        // Storage unavailable
    }
}

function addDisplay(host) {
    host = host.trim();
    if (!host) {
        logActivity('error', 'Address required');
        return false;
    }
    if (state.additionalDisplays.some(d => d.host === host)) {
        logActivity('error', 'Already added');
        return false;
    }
    
    state.additionalDisplays.push({ host, lastStatus: 'pending' });
    saveAdditionalDisplays();
    renderDisplaysList();
    logActivity('success', `Added: ${host}`);
    return true;
}

function removeDisplay(host) {
    state.additionalDisplays = state.additionalDisplays.filter(d => d.host !== host);
    saveAdditionalDisplays();
    renderDisplaysList();
    logActivity('info', `Removed: ${host}`);
}

function renderDisplaysList() {
    const listEl = document.getElementById('displays-list');
    const emptyEl = document.getElementById('no-displays');
    
    if (state.additionalDisplays.length === 0) {
        emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        listEl.appendChild(emptyEl);
        return;
    }
    
    emptyEl.style.display = 'none';
    listEl.innerHTML = state.additionalDisplays.map(d => `
        <div class="display-item" data-host="${d.host}">
            <div class="display-item-info">
                <span class="display-item-host">${d.host}</span>
                <span class="display-item-status ${d.lastStatus}" id="display-status-${encodeId(d.host)}">
                    ${d.lastStatus === 'synced' ? '✓ Synced' : d.lastStatus === 'error' ? '✗ Error' : '⏳ Pending'}
                </span>
            </div>
            <div class="display-item-actions">
                <button class="btn-icon btn-danger remove-display" data-host="${d.host}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
    
    listEl.querySelectorAll('.remove-display').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm(`Remove ${btn.dataset.host}?`)) {
                removeDisplay(btn.dataset.host);
            }
        });
    });
}

function updateDisplayItemStatus(host, status) {
    const display = state.additionalDisplays.find(d => d.host === host);
    if (display) display.lastStatus = status;
    
    const el = document.getElementById(`display-status-${encodeId(host)}`);
    if (el) {
        el.className = `display-item-status ${status}`;
        el.textContent = status === 'synced' ? '✓ Synced' : status === 'error' ? '✗ Error' : '⏳ Pending';
    }
}

function encodeId(host) {
    return host.replace(/[^a-zA-Z0-9]/g, '_');
}

// ============================================================
// Utilities (use common.js)
// ============================================================
// formatBytes, formatUptime, fetchWithTimeout are in common.js

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connection-status');
    const text = indicator.querySelector('.text');
    indicator.className = 'status-indicator ' + status;
    text.textContent = status === 'connected' ? 'Connected' : status === 'error' ? 'Offline Mode' : 'Disconnected';
}

// logActivity function (keep - specific to embedded)
function logActivity(type, message) {
    const logEl = document.getElementById('activity-log');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="time">${time}</span><span class="message">${message}</span>`;
    
    if (logEl.firstChild) {
        logEl.insertBefore(entry, logEl.firstChild);
    } else {
        logEl.appendChild(entry);
    }
    
    while (logEl.children.length > CONFIG.maxLogEntries) {
        logEl.removeChild(logEl.lastChild);
    }
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ============================================================
// Initialize
// ============================================================
document.addEventListener('DOMContentLoaded', initializeApp);

window.addEventListener('beforeunload', () => {
    if (state.meetingCheckTimer) clearInterval(state.meetingCheckTimer);
    if (state.statusPollTimer) clearInterval(state.statusPollTimer);
});
