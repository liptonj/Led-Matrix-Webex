/**
 * LED Matrix Display - Webex Embedded App (Cloud Hosted)
 * 
 * SDK v2.x compatible embedded app with:
 * - Display connection via IP/hostname
 * - Webex SDK integration for meeting/call detection
 * - Manual status and camera/mic toggles
 * - Full display configuration
 * 
 * Hosted on Cloudflare Pages, connects to local ESP32 display.
 */

/* global Webex, webex */

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
    storageKey: 'led_matrix_display_address',
    settingsKey: 'led_matrix_settings',
    maxLogEntries: 30,
    maxRetries: 3,
    retryDelayMs: 2000,
    meetingCheckInterval: 10000,
    statusPollInterval: 5000,
    connectionTimeout: 5000
};

// ============================================================
// Application State
// ============================================================
const state = {
    webexApp: null,
    user: null,
    displayAddress: null,
    isConnected: false,
    currentStatus: null,
    previousStatus: null,
    isInMeeting: false,
    isInCall: false,
    cameraOn: false,
    micMuted: false,
    autoSync: true,
    isInitialized: false,
    lastSyncTime: null,
    meetingCheckTimer: null,
    statusPollTimer: null,
    displayConfig: {}
};

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    logActivity('info', 'Initializing Webex Embedded App...');
    
    // Initialize tabs
    initTabs();
    
    // Setup event listeners
    setupEventListeners();
    
    // Check for saved display address
    const savedAddress = localStorage.getItem(CONFIG.storageKey);
    if (savedAddress) {
        logActivity('info', `Found saved display: ${savedAddress}`);
        await connectToDisplay(savedAddress);
    } else {
        showSetupScreen();
    }
    
    // Initialize Webex SDK
    await initializeWebexSDK();
}

async function initializeWebexSDK() {
    try {
        // Check if Webex SDK is available (v1 or v2)
        let AppClass = null;
        
        if (typeof webex !== 'undefined' && webex.Application) {
            // SDK v2.x
            AppClass = webex.Application;
            logActivity('info', 'Using Webex SDK v2.x');
        } else if (typeof Webex !== 'undefined' && Webex.Application) {
            // SDK v1.x (fallback)
            AppClass = Webex.Application;
            logActivity('info', 'Using Webex SDK v1.x (deprecated)');
        } else {
            throw new Error('Webex SDK not loaded');
        }
        
        state.webexApp = new AppClass();
        
        logActivity('info', 'Waiting for Webex connection...');
        await state.webexApp.onReady();
        logActivity('success', 'Connected to Webex');
        
        await getUserContext();
        await startPresenceMonitoring();
        
        updateConnectionStatus('webex', true);
        state.isInitialized = true;
        
        logActivity('success', 'Webex app ready');
        
    } catch (error) {
        console.error('Webex SDK init failed:', error);
        logActivity('error', `Webex: ${error.message}`);
        updateConnectionStatus('webex', false);
        
        // App still works for configuration even without Webex
        document.getElementById('user-name').textContent = 'Not in Webex';
        document.getElementById('user-status').textContent = 'Configuration mode only';
    }
}

// ============================================================
// Display Connection
// ============================================================
function showSetupScreen() {
    document.getElementById('setup-screen').style.display = 'block';
    document.getElementById('main-screen').style.display = 'none';
    updateConnectionStatus('display', false);
}

function showMainScreen() {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';
}

async function connectToDisplay(address) {
    const errorEl = document.getElementById('connection-error');
    const connectBtn = document.getElementById('connect-btn');
    
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
    }
    
    if (errorEl) {
        errorEl.style.display = 'none';
    }
    
    // Clean up address
    address = address.trim().toLowerCase();
    if (address.startsWith('http://')) {
        address = address.replace('http://', '');
    }
    if (address.startsWith('https://')) {
        address = address.replace('https://', '');
    }
    if (address.endsWith('/')) {
        address = address.slice(0, -1);
    }
    
    logActivity('info', `Connecting to ${address}...`);
    
    try {
        const response = await fetchWithTimeout(`http://${address}/api/status`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        }, CONFIG.connectionTimeout);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Connection successful
        state.displayAddress = address;
        state.isConnected = true;
        localStorage.setItem(CONFIG.storageKey, address);
        
        logActivity('success', `Connected to display at ${address}`);
        updateConnectionStatus('display', true);
        
        // Update display info
        document.getElementById('display-host').textContent = address;
        document.getElementById('ip-address').textContent = data.ip_address || address;
        document.getElementById('firmware-version').textContent = data.firmware_version || '--';
        document.getElementById('app-version').textContent = 'v' + (data.firmware_version || '1.0.0');
        
        // Show main screen
        showMainScreen();
        
        // Load display data
        await loadDisplayStatus();
        await loadDisplayConfig();
        
        // Start polling
        state.statusPollTimer = setInterval(loadDisplayStatus, CONFIG.statusPollInterval);
        
    } catch (error) {
        console.error('Connection failed:', error);
        logActivity('error', `Failed to connect: ${error.message}`);
        
        state.isConnected = false;
        updateConnectionStatus('display', false);
        
        if (errorEl) {
            errorEl.textContent = `Cannot connect to display at "${address}". ` +
                'Make sure the display is powered on and you are on the same network.';
            errorEl.style.display = 'block';
        }
        
        showSetupScreen();
    }
    
    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect to Display';
    }
}

function disconnectDisplay() {
    localStorage.removeItem(CONFIG.storageKey);
    state.displayAddress = null;
    state.isConnected = false;
    
    if (state.statusPollTimer) {
        clearInterval(state.statusPollTimer);
        state.statusPollTimer = null;
    }
    
    logActivity('info', 'Disconnected from display');
    showSetupScreen();
}

// ============================================================
// Tab Navigation
// ============================================================
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// ============================================================
// Webex SDK Integration
// ============================================================
async function getUserContext() {
    try {
        // Try v2 style first (static user property)
        if (state.webexApp.user) {
            state.user = {
                id: state.webexApp.user.id,
                email: state.webexApp.user.email,
                displayName: state.webexApp.user.displayName || state.webexApp.user.email?.split('@')[0] || 'User',
                orgId: state.webexApp.user.orgId
            };
        } else if (state.webexApp.context && state.webexApp.context.getUser) {
            // Fall back to v1 style
            const context = await state.webexApp.context.getUser();
            state.user = {
                id: context.id,
                email: context.email,
                displayName: context.displayName || context.email?.split('@')[0] || 'User',
                orgId: context.orgId
            };
        } else {
            throw new Error('Cannot get user info');
        }
        
        updateUserDisplay();
        logActivity('info', `Signed in: ${state.user.displayName}`);
    } catch (error) {
        console.error('Failed to get user context:', error);
        logActivity('error', 'Could not get user info');
        throw error;
    }
}

async function startPresenceMonitoring() {
    logActivity('info', 'Starting meeting/call detection...');
    
    try {
        // Check initial meeting state
        await checkMeetingState();
        
        // Register for meeting events
        if (state.webexApp.on) {
            // Listen for meeting changes
            state.webexApp.on('meeting:infoChanged', handleMeetingChange);
            
            // Listen for sidebar call events (v2.x)
            state.webexApp.on('sidebar:callStateChanged', handleCallStateChange);
            
            // Listen for view state changes
            state.webexApp.on('application:viewStateChanged', handleViewStateChange);
        } else if (state.webexApp.context && state.webexApp.context.on) {
            // v1.x fallback
            state.webexApp.context.on('meeting', handleMeetingChange);
        }
        
        // Poll for meeting state periodically
        state.meetingCheckTimer = setInterval(checkMeetingState, CONFIG.meetingCheckInterval);
        logActivity('success', 'Meeting/call detection active');
        
    } catch (error) {
        console.error('Meeting monitoring failed:', error);
        logActivity('error', 'Meeting detection unavailable');
    }
    
    setupStatusButtons();
    setupHardwareToggles();
}

async function checkMeetingState() {
    try {
        let meeting = null;
        
        if (state.webexApp.context && state.webexApp.context.getMeeting) {
            meeting = await state.webexApp.context.getMeeting().catch(() => null);
        }
        
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
            // Optionally set status back to available
            // setStatus('active', true);
        }
    }
}

function handleCallStateChange(call) {
    // Sidebar API call state event (v2.x)
    logActivity('info', `Call state: ${call?.state || 'unknown'}`);
    
    if (call && call.state === 'Started') {
        state.isInCall = true;
        setStatus('meeting', true);
    } else if (call && call.state === 'Ended') {
        state.isInCall = false;
        // Optionally set status back
    }
}

function handleViewStateChange(viewState) {
    logActivity('info', `View state: ${viewState}`);
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

function setupHardwareToggles() {
    // Camera toggle
    const cameraBtn = document.getElementById('camera-toggle');
    cameraBtn.addEventListener('click', () => {
        state.cameraOn = !state.cameraOn;
        updateCameraToggle();
        syncStatusToDisplay();
    });
    
    // Mic toggle
    const micBtn = document.getElementById('mic-toggle');
    micBtn.addEventListener('click', () => {
        state.micMuted = !state.micMuted;
        updateMicToggle();
        syncStatusToDisplay();
    });
}

function updateCameraToggle() {
    const btn = document.getElementById('camera-toggle');
    const icon = document.getElementById('camera-icon');
    const label = document.getElementById('camera-label');
    
    if (state.cameraOn) {
        btn.classList.add('active');
        btn.dataset.active = 'true';
        icon.textContent = '📹';
        label.textContent = 'Camera On';
    } else {
        btn.classList.remove('active');
        btn.dataset.active = 'false';
        icon.textContent = '📷';
        label.textContent = 'Camera Off';
    }
}

function updateMicToggle() {
    const btn = document.getElementById('mic-toggle');
    const icon = document.getElementById('mic-icon');
    const label = document.getElementById('mic-label');
    
    if (state.micMuted) {
        btn.classList.remove('active');
        btn.dataset.active = 'false';
        icon.textContent = '🔇';
        label.textContent = 'Mic Muted';
    } else {
        btn.classList.add('active');
        btn.dataset.active = 'true';
        icon.textContent = '🎤';
        label.textContent = 'Mic On';
    }
}

function setStatus(status, autoDetected = false) {
    state.previousStatus = state.currentStatus;
    state.currentStatus = status;
    
    updatePresenceDisplay(status);
    
    if (state.previousStatus !== state.currentStatus) {
        logActivity('info', `Status: ${formatStatus(status)}${autoDetected ? ' (auto)' : ''}`);
        if (state.autoSync && state.isConnected) {
            syncStatusToDisplay();
        }
    }
}

function updatePresenceDisplay(status) {
    const statusEl = document.getElementById('user-status');
    const avatarEl = document.getElementById('presence-avatar');
    
    statusEl.textContent = formatStatus(status);
    avatarEl.className = 'presence-avatar ' + status;
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
async function syncStatusToDisplay() {
    if (!state.isConnected || !state.displayAddress) {
        logActivity('error', 'Not connected to display');
        return false;
    }
    
    if (!state.currentStatus) {
        return false;
    }
    
    const displayStatus = mapToDisplayStatus(state.currentStatus);
    
    try {
        const response = await fetchWithTimeout(`http://${state.displayAddress}/api/embedded/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: displayStatus,
                displayName: state.user?.displayName || 'Unknown',
                in_call: state.isInMeeting || state.isInCall,
                camera_on: state.cameraOn,
                mic_muted: state.micMuted,
                source: 'embedded-app',
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            logActivity('success', 'Status synced to display');
            updateSyncStatus(true);
            state.lastSyncTime = new Date();
            return true;
        }
        throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        logActivity('error', `Sync failed: ${error.message}`);
        updateSyncStatus(false);
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
    if (!state.isConnected || !state.displayAddress) return;
    
    try {
        const response = await fetch(`http://${state.displayAddress}/api/status`);
        const data = await response.json();
        
        // Update status tab
        document.getElementById('display-status').textContent = data.webex_status || '--';
        document.getElementById('camera-status').textContent = data.camera_on ? 'On' : 'Off';
        document.getElementById('mic-status').textContent = data.mic_muted ? 'Muted' : 'On';
        document.getElementById('call-status').textContent = data.in_call ? 'Yes' : 'No';
        
        // System info
        document.getElementById('firmware-version').textContent = data.firmware_version || '--';
        document.getElementById('sys-firmware-version').textContent = data.firmware_version || '--';
        document.getElementById('firmware-build-id').textContent = data.firmware_build_id || '--';
        document.getElementById('current-version').textContent = data.firmware_version || '--';
        document.getElementById('ip-address').textContent = data.ip_address || '--';
        document.getElementById('free-heap').textContent = formatBytes(data.free_heap);
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('wifi-signal').textContent = data.rssi ? `${data.rssi} dBm` : '--';
        
    } catch (error) {
        console.error('Failed to load status:', error);
    }
}

async function loadDisplayConfig() {
    if (!state.isConnected || !state.displayAddress) return;
    
    try {
        const response = await fetch(`http://${state.displayAddress}/api/config`);
        state.displayConfig = await response.json();
        
        // Populate form fields
        document.getElementById('device-name').value = state.displayConfig.device_name || '';
        document.getElementById('display-name').value = state.displayConfig.display_name || '';
        document.getElementById('brightness').value = state.displayConfig.brightness || 128;
        document.getElementById('brightness-value').textContent = state.displayConfig.brightness || 128;
        document.getElementById('poll-interval').value = state.displayConfig.poll_interval || 30;
        
        // Auth status
        const authStatus = document.getElementById('webex-auth-status');
        if (state.displayConfig.has_webex_tokens) {
            authStatus.textContent = 'Connected';
            authStatus.style.color = '#6cc04a';
        } else if (state.displayConfig.has_webex_credentials) {
            authStatus.textContent = 'Not authorized';
            authStatus.style.color = '#ffcc00';
        } else {
            authStatus.textContent = 'Not configured';
            authStatus.style.color = '#ff5c5c';
        }
        
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// ============================================================
// Event Listeners
// ============================================================
function setupEventListeners() {
    // Setup screen - connect button
    document.getElementById('connect-btn').addEventListener('click', () => {
        const address = document.getElementById('display-address').value;
        if (address) {
            connectToDisplay(address);
        }
    });
    
    // Setup screen - enter key
    document.getElementById('display-address').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('connect-btn').click();
        }
    });
    
    // Disconnect button
    document.getElementById('disconnect-display').addEventListener('click', () => {
        if (confirm('Disconnect from this display?')) {
            disconnectDisplay();
        }
    });
    
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
            poll_interval: parseInt(document.getElementById('poll-interval').value)
        });
    });
    
    // Webex credentials form
    document.getElementById('webex-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig({
            webex_client_id: document.getElementById('webex-client-id').value,
            webex_client_secret: document.getElementById('webex-client-secret').value
        });
    });
    
    // Webex auth button
    document.getElementById('webex-auth-btn').addEventListener('click', startWebexAuth);
    
    // Auto-sync toggle
    document.getElementById('auto-sync').addEventListener('change', (e) => {
        state.autoSync = e.target.checked;
        logActivity('info', state.autoSync ? 'Auto-sync enabled' : 'Auto-sync disabled');
    });
    
    // WiFi scan
    document.getElementById('scan-wifi').addEventListener('click', scanWifi);
    
    // WiFi form
    document.getElementById('wifi-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveWifi();
    });
    
    // OTA buttons
    document.getElementById('check-update').addEventListener('click', checkForUpdate);
    document.getElementById('perform-update').addEventListener('click', performUpdate);
    
    // System buttons
    document.getElementById('reboot-btn').addEventListener('click', rebootDevice);
    document.getElementById('factory-reset-btn').addEventListener('click', factoryReset);
}

async function saveConfig(data) {
    if (!state.isConnected || !state.displayAddress) {
        logActivity('error', 'Not connected to display');
        return;
    }
    
    try {
        const response = await fetch(`http://${state.displayAddress}/api/config`, {
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

async function startWebexAuth() {
    if (!state.isConnected || !state.displayAddress) {
        logActivity('error', 'Not connected to display');
        return;
    }
    
    try {
        const response = await fetch(`http://${state.displayAddress}/api/webex/auth`);
        const data = await response.json();
        if (data.auth_url) {
            window.open(data.auth_url, '_blank');
            logActivity('info', 'Opened Webex authorization');
        }
    } catch (error) {
        logActivity('error', 'Failed to start auth');
    }
}

async function scanWifi() {
    if (!state.isConnected || !state.displayAddress) return;
    
    const btn = document.getElementById('scan-wifi');
    const listEl = document.getElementById('wifi-networks');
    
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    listEl.innerHTML = '<div class="network-item">Scanning...</div>';
    
    try {
        const response = await fetch(`http://${state.displayAddress}/api/wifi/scan`);
        const data = await response.json();
        
        listEl.innerHTML = data.networks.map(n => `
            <div class="network-item" data-ssid="${n.ssid}">
                <span class="ssid">${n.ssid}</span>
                <span class="signal">${n.rssi} dBm ${n.encrypted ? '🔒' : ''}</span>
            </div>
        `).join('');
        
        listEl.querySelectorAll('.network-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('wifi-ssid').value = item.dataset.ssid;
            });
        });
        
    } catch (error) {
        listEl.innerHTML = '<div class="network-item">Scan failed</div>';
    }
    
    btn.disabled = false;
    btn.textContent = 'Scan Networks';
}

async function saveWifi() {
    if (!state.isConnected || !state.displayAddress) return;
    
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    
    if (!ssid) {
        logActivity('error', 'SSID required');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('ssid', ssid);
        formData.append('password', password);
        
        await fetch(`http://${state.displayAddress}/api/wifi/save`, { method: 'POST', body: formData });
        logActivity('success', 'WiFi saved - rebooting...');
    } catch (error) {
        logActivity('error', 'Failed to save WiFi');
    }
}

async function checkForUpdate() {
    if (!state.isConnected || !state.displayAddress) return;
    
    const btn = document.getElementById('check-update');
    btn.disabled = true;
    btn.textContent = 'Checking...';
    
    try {
        const response = await fetch(`http://${state.displayAddress}/api/ota/check`);
        const data = await response.json();
        document.getElementById('latest-version').textContent = data.latest_version || 'Unknown';
        if (data.update_available) {
            document.getElementById('perform-update').disabled = false;
            logActivity('info', 'Update available!');
        }
    } catch (error) {
        logActivity('error', 'Update check failed');
    }
    
    btn.disabled = false;
    btn.textContent = 'Check for Updates';
}

async function performUpdate() {
    if (!state.isConnected || !state.displayAddress) return;
    if (!confirm('Install update? Device will restart.')) return;
    
    try {
        await fetch(`http://${state.displayAddress}/api/ota/update`, { method: 'POST' });
        logActivity('info', 'Update started...');
    } catch (error) {
        logActivity('error', 'Update failed');
    }
}

async function rebootDevice() {
    if (!state.isConnected || !state.displayAddress) return;
    if (!confirm('Reboot the display?')) return;
    
    try {
        await fetch(`http://${state.displayAddress}/api/reboot`, { method: 'POST' });
        logActivity('info', 'Rebooting...');
    } catch (error) {
        logActivity('error', 'Reboot failed');
    }
}

async function factoryReset() {
    if (!state.isConnected || !state.displayAddress) return;
    if (!confirm('Factory reset? All settings will be erased!')) return;
    if (!confirm('This cannot be undone. Continue?')) return;
    
    try {
        await fetch(`http://${state.displayAddress}/api/factory-reset`, { method: 'POST' });
        logActivity('info', 'Factory reset...');
    } catch (error) {
        logActivity('error', 'Reset failed');
    }
}

// ============================================================
// Utilities
// ============================================================
function updateConnectionStatus(type, connected) {
    const indicator = document.getElementById('connection-status');
    const text = indicator.querySelector('.text');
    
    if (type === 'display') {
        if (connected) {
            indicator.className = 'status-indicator connected';
            text.textContent = 'Display Connected';
        } else {
            indicator.className = 'status-indicator disconnected';
            text.textContent = 'No Display';
        }
    } else if (type === 'webex') {
        // Webex status is secondary - only update if display connected
        if (state.isConnected && connected) {
            indicator.className = 'status-indicator connected';
            text.textContent = 'Connected';
        }
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

function formatBytes(bytes) {
    if (!bytes) return '--';
    return (bytes / 1024).toFixed(1) + ' KB';
}

function formatUptime(seconds) {
    if (!seconds) return '--';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function logActivity(type, message) {
    const logEl = document.getElementById('activity-log');
    if (!logEl) return;
    
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
// Cleanup
// ============================================================
window.addEventListener('beforeunload', () => {
    if (state.meetingCheckTimer) clearInterval(state.meetingCheckTimer);
    if (state.statusPollTimer) clearInterval(state.statusPollTimer);
});
