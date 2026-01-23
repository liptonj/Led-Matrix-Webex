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
    bridgeUrlKey: 'led_matrix_bridge_url',
    pairingCodeKey: 'led_matrix_pairing_code',
    connectionModeKey: 'led_matrix_connection_mode',
    settingsKey: 'led_matrix_settings',
    bridgeConfigUrl: '/api/bridge-config.json',
    maxLogEntries: 30,
    maxRetries: 3,
    retryDelayMs: 2000,
    meetingCheckInterval: 10000,
    statusPollInterval: 5000,
    connectionTimeout: 5000,
    wsReconnectDelay: 3000,
    wsPingInterval: 30000,
    // New: Continuous sync and call polling intervals
    statusSyncInterval: 30000,   // Sync status to bridge every 30 seconds
    callPollInterval: 5000,      // Poll for call state every 5 seconds (for mic status)
    // Bridge config from discovery endpoint (populated at runtime)
    discoveredBridgeUrl: null,
    discoveredFallbackUrl: null
};

// ============================================================
// Application State
// ============================================================
const state = {
    webexApp: null,
    user: null,
    displayAddress: null,
    bridgeUrl: null,
    pairingCode: null,
    connectionMode: 'bridge', // 'bridge' or 'direct'
    ws: null,
    wsConnected: false,
    wsPeerConnected: false,
    wsReconnectTimer: null,
    wsPingTimer: null,
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
    callPollTimer: null,       // Timer for polling call state (mic status)
    statusSyncTimer: null,     // Timer for periodic status sync to bridge
    displayConfig: {},
    pendingCommands: new Map(),  // requestId -> { resolve, reject, timeout }
    commandTimeout: 10000  // 10 second timeout for commands
};

// ============================================================
// Bridge Discovery
// ============================================================

/**
 * Fetch bridge configuration from discovery endpoint
 * This allows the bridge URL to be updated without app changes
 */
async function fetchBridgeConfig() {
    try {
        logActivity('info', 'Fetching bridge configuration...');
        
        const response = await fetch(CONFIG.bridgeConfigUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const config = await response.json();
        
        if (config.bridge && config.bridge.url) {
            CONFIG.discoveredBridgeUrl = config.bridge.url;
            CONFIG.discoveredFallbackUrl = config.bridge.fallback_url || null;
            
            logActivity('success', `Bridge URL discovered: ${CONFIG.discoveredBridgeUrl}`);
            
            // Pre-populate the bridge URL input if it's empty
            const bridgeUrlInput = document.getElementById('bridge-url');
            if (bridgeUrlInput && !bridgeUrlInput.value && !localStorage.getItem(CONFIG.bridgeUrlKey)) {
                bridgeUrlInput.value = CONFIG.discoveredBridgeUrl;
                bridgeUrlInput.placeholder = CONFIG.discoveredBridgeUrl;
            }
        }
    } catch (error) {
        console.warn('Failed to fetch bridge config:', error);
        logActivity('info', 'Using default bridge configuration');
        // Use hardcoded default if discovery fails
        CONFIG.discoveredBridgeUrl = 'wss://bridge.5ls.us';
    }
}

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
    
    // Fetch bridge configuration from discovery endpoint
    await fetchBridgeConfig();
    
    // Load saved connection mode
    state.connectionMode = localStorage.getItem(CONFIG.connectionModeKey) || 'bridge';
    
    // Check for saved connection based on mode
    if (state.connectionMode === 'bridge') {
        const savedBridgeUrl = localStorage.getItem(CONFIG.bridgeUrlKey);
        const savedPairingCode = localStorage.getItem(CONFIG.pairingCodeKey);
        
        if (savedBridgeUrl && savedPairingCode) {
            logActivity('info', `Found saved bridge: ${savedBridgeUrl}, code: ${savedPairingCode}`);
            await connectToBridge(savedBridgeUrl, savedPairingCode);
        } else {
            showSetupScreen();
        }
    } else {
        // Direct mode
        const savedAddress = localStorage.getItem(CONFIG.storageKey);
        if (savedAddress) {
            logActivity('info', `Found saved display: ${savedAddress}`);
            await connectToDisplay(savedAddress);
        } else {
            showSetupScreen();
        }
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

// ============================================================
// WebSocket Bridge Connection
// ============================================================
async function connectToBridge(bridgeUrl, pairingCode) {
    const errorEl = document.getElementById('connection-error');
    const connectBtn = document.getElementById('connect-bridge-btn');
    
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
    }
    
    if (errorEl) {
        errorEl.style.display = 'none';
    }
    
    // Normalize inputs
    bridgeUrl = bridgeUrl.trim();
    pairingCode = pairingCode.trim().toUpperCase();
    
    // Ensure ws:// or wss:// prefix
    if (!bridgeUrl.startsWith('ws://') && !bridgeUrl.startsWith('wss://')) {
        // Default to wss:// for domain names (likely tunnel), ws:// for IP/local
        if (bridgeUrl.includes('.local') || /^\d+\.\d+\.\d+\.\d+/.test(bridgeUrl)) {
            bridgeUrl = 'ws://' + bridgeUrl;
        } else {
            bridgeUrl = 'wss://' + bridgeUrl;
        }
    }
    
    logActivity('info', `Connecting to bridge: ${bridgeUrl} with code: ${pairingCode}`);
    
    try {
        // Close existing connection if any
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        
        // Create WebSocket connection
        state.ws = new WebSocket(bridgeUrl);
        state.bridgeUrl = bridgeUrl;
        state.pairingCode = pairingCode;
        
        // Setup WebSocket event handlers
        state.ws.onopen = () => {
            logActivity('success', 'WebSocket connected');
            state.wsConnected = true;
            
            // Send join message
            state.ws.send(JSON.stringify({
                type: 'join',
                code: pairingCode,
                clientType: 'app'
            }));
            
            // Start ping interval
            state.wsPingTimer = setInterval(() => {
                if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                    state.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, CONFIG.wsPingInterval);
        };
        
        state.ws.onmessage = (event) => {
            handleBridgeMessage(event.data);
        };
        
        state.ws.onclose = () => {
            logActivity('info', 'WebSocket disconnected');
            state.wsConnected = false;
            state.wsPeerConnected = false;
            updateConnectionStatus('display', false);
            
            // Clear ping timer
            if (state.wsPingTimer) {
                clearInterval(state.wsPingTimer);
                state.wsPingTimer = null;
            }
            
            // Auto-reconnect if we were connected
            if (state.isConnected && !state.wsReconnectTimer) {
                logActivity('info', 'Attempting to reconnect...');
                state.wsReconnectTimer = setTimeout(() => {
                    state.wsReconnectTimer = null;
                    connectToBridge(state.bridgeUrl, state.pairingCode);
                }, CONFIG.wsReconnectDelay);
            }
        };
        
        state.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            logActivity('error', 'WebSocket connection error');
        };
        
        // Wait for connection and join confirmation
        await waitForJoinConfirmation();
        
        // Save connection settings
        localStorage.setItem(CONFIG.bridgeUrlKey, bridgeUrl);
        localStorage.setItem(CONFIG.pairingCodeKey, pairingCode);
        localStorage.setItem(CONFIG.connectionModeKey, 'bridge');
        
        state.isConnected = true;
        state.connectionMode = 'bridge';
        updateConnectionStatus('display', true);
        
        // Show main screen
        showMainScreen();
        
        logActivity('success', `Connected to bridge with code: ${pairingCode}`);
        
    } catch (error) {
        console.error('Bridge connection failed:', error);
        logActivity('error', `Failed to connect: ${error.message}`);
        
        state.isConnected = false;
        state.wsConnected = false;
        updateConnectionStatus('display', false);
        
        if (errorEl) {
            errorEl.textContent = `Cannot connect to bridge. ${error.message}`;
            errorEl.style.display = 'block';
        }
        
        showSetupScreen();
    }
    
    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect via Bridge';
    }
}

function waitForJoinConfirmation() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
        }, CONFIG.connectionTimeout);
        
        const originalHandler = state.ws.onmessage;
        state.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'joined') {
                    clearTimeout(timeout);
                    state.ws.onmessage = originalHandler;
                    resolve(message);
                } else if (message.type === 'error') {
                    clearTimeout(timeout);
                    state.ws.onmessage = originalHandler;
                    reject(new Error(message.message || 'Join failed'));
                }
            } catch (e) {
                // Ignore parse errors during handshake
            }
        };
    });
}

function handleBridgeMessage(data) {
    try {
        const message = JSON.parse(data);
        
        switch (message.type) {
            case 'joined':
                logActivity('success', `Joined room ${message.data?.code}`);
                state.wsPeerConnected = message.data?.displayConnected || false;
                if (state.wsPeerConnected) {
                    logActivity('info', 'Display is connected');
                    // Request initial status and config from display
                    sendBridgeCommand('get_status').catch(() => {});
                    sendBridgeCommand('get_config').catch(() => {});
                }
                break;
                
            case 'peer_connected':
                logActivity('success', `${message.data?.peerType} connected`);
                state.wsPeerConnected = true;
                // Request status and config when display connects
                sendBridgeCommand('get_status').catch(() => {});
                sendBridgeCommand('get_config').catch(() => {});
                break;
                
            case 'peer_disconnected':
                logActivity('info', `${message.data?.peerType} disconnected`);
                state.wsPeerConnected = false;
                break;
                
            case 'status':
                // Status update from display
                if (message.data) {
                    updateDisplayStatusFromBridge(message.data);
                } else {
                    logActivity('info', `Status from display: ${message.status}`);
                }
                break;
                
            case 'config':
                // Config from display
                if (message.data) {
                    updateDisplayConfigFromBridge(message.data);
                }
                break;
                
            case 'command_response':
                // Response to a command we sent
                handleCommandResponse(message);
                break;
                
            case 'pong':
                // Ping response, connection is alive
                break;
                
            case 'error':
                logActivity('error', message.message || 'Bridge error');
                break;
                
            default:
                logActivity('info', `Bridge message: ${message.type}`);
        }
    } catch (error) {
        console.error('Failed to parse bridge message:', error);
    }
}

/**
 * Send a command to the display via WebSocket bridge
 * @param {string} command - Command name
 * @param {object} payload - Command payload
 * @returns {Promise} Resolves with response data
 */
function sendBridgeCommand(command, payload = {}) {
    return new Promise((resolve, reject) => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not connected'));
            return;
        }
        
        if (!state.wsPeerConnected) {
            reject(new Error('Display not connected'));
            return;
        }
        
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Set up timeout
        const timeout = setTimeout(() => {
            state.pendingCommands.delete(requestId);
            reject(new Error('Command timeout'));
        }, state.commandTimeout);
        
        // Store pending command
        state.pendingCommands.set(requestId, { resolve, reject, timeout });
        
        // Send command
        state.ws.send(JSON.stringify({
            type: 'command',
            command,
            requestId,
            payload
        }));
        
        logActivity('info', `Sent command: ${command}`);
    });
}

/**
 * Handle command response from display
 */
function handleCommandResponse(message) {
    const pending = state.pendingCommands.get(message.requestId);
    if (!pending) {
        return; // No pending command for this response
    }
    
    clearTimeout(pending.timeout);
    state.pendingCommands.delete(message.requestId);
    
    if (message.success) {
        pending.resolve(message.data || {});
    } else {
        pending.reject(new Error(message.error || 'Command failed'));
    }
}

/**
 * Update display status from bridge message
 */
function updateDisplayStatusFromBridge(data) {
    // Update status tab
    if (document.getElementById('display-status')) {
        document.getElementById('display-status').textContent = data.webex_status || '--';
    }
    if (document.getElementById('camera-status')) {
        document.getElementById('camera-status').textContent = data.camera_on ? 'On' : 'Off';
    }
    if (document.getElementById('mic-status')) {
        document.getElementById('mic-status').textContent = data.mic_muted ? 'Muted' : 'On';
    }
    if (document.getElementById('call-status')) {
        document.getElementById('call-status').textContent = data.in_call ? 'Yes' : 'No';
    }
    
    // System info
    if (document.getElementById('firmware-version')) {
        document.getElementById('firmware-version').textContent = data.firmware_version || '--';
    }
    if (document.getElementById('sys-firmware-version')) {
        document.getElementById('sys-firmware-version').textContent = data.firmware_version || '--';
    }
    if (document.getElementById('ip-address')) {
        document.getElementById('ip-address').textContent = data.ip_address || '--';
    }
    if (document.getElementById('free-heap')) {
        document.getElementById('free-heap').textContent = formatBytes(data.free_heap);
    }
    if (document.getElementById('uptime')) {
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
    }
    if (document.getElementById('wifi-signal')) {
        document.getElementById('wifi-signal').textContent = data.rssi ? `${data.rssi} dBm` : '--';
    }
    
    logActivity('info', 'Status updated from display');
}

/**
 * Update display config from bridge message
 */
function updateDisplayConfigFromBridge(data) {
    state.displayConfig = data;
    
    // Populate form fields
    if (document.getElementById('device-name')) {
        document.getElementById('device-name').value = data.device_name || '';
    }
    if (document.getElementById('display-name')) {
        document.getElementById('display-name').value = data.display_name || '';
    }
    if (document.getElementById('brightness')) {
        document.getElementById('brightness').value = data.brightness || 128;
        document.getElementById('brightness-value').textContent = data.brightness || 128;
    }
    if (document.getElementById('poll-interval')) {
        document.getElementById('poll-interval').value = data.poll_interval || 30;
    }
    
    // Show pairing code if available
    if (data.pairing_code && document.getElementById('display-pairing-code')) {
        document.getElementById('display-pairing-code').textContent = data.pairing_code;
    }
    
    // Auth status
    const authStatus = document.getElementById('webex-auth-status');
    if (authStatus) {
        if (data.has_webex_tokens) {
            authStatus.textContent = 'Connected';
            authStatus.style.color = '#6cc04a';
        } else if (data.has_webex_credentials) {
            authStatus.textContent = 'Not authorized';
            authStatus.style.color = '#ffcc00';
        } else {
            authStatus.textContent = 'Not configured';
            authStatus.style.color = '#ff5c5c';
        }
    }
    
    logActivity('info', 'Config updated from display');
}

function disconnectBridge() {
    // Close WebSocket connection
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    
    // Clear WebSocket-specific timers
    if (state.wsReconnectTimer) {
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = null;
    }
    
    if (state.wsPingTimer) {
        clearInterval(state.wsPingTimer);
        state.wsPingTimer = null;
    }
    
    // Clear status sync timer (will restart when reconnected)
    if (state.statusSyncTimer) {
        clearInterval(state.statusSyncTimer);
        state.statusSyncTimer = null;
    }
    
    localStorage.removeItem(CONFIG.bridgeUrlKey);
    localStorage.removeItem(CONFIG.pairingCodeKey);
    
    state.bridgeUrl = null;
    state.pairingCode = null;
    state.wsConnected = false;
    state.wsPeerConnected = false;
    state.isConnected = false;
    
    logActivity('info', 'Disconnected from bridge');
    showSetupScreen();
}

// ============================================================
// Direct Display Connection (Legacy/Fallback)
// ============================================================
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
        
        // SDK requires listen() before registering event handlers
        if (state.webexApp.listen) {
            try {
                await state.webexApp.listen();
                logActivity('info', 'SDK event listener registered');
            } catch (listenError) {
                console.warn('app.listen() failed:', listenError);
                // Continue anyway - events may still work in some contexts
            }
        }
        
        // Register for meeting events
        if (state.webexApp.on) {
            // Listen for meeting changes
            state.webexApp.on('meeting:infoChanged', handleMeetingChange);
            
            // Listen for sidebar call events (v2.x)
            state.webexApp.on('sidebar:callStateChanged', handleCallStateChange);
            
            // Listen for view state changes
            state.webexApp.on('application:viewStateChanged', handleViewStateChange);
            
            // Listen for theme changes
            state.webexApp.on('application:themeChanged', (theme) => {
                logActivity('info', `Theme changed: ${theme}`);
            });
        } else if (state.webexApp.context && state.webexApp.context.on) {
            // v1.x fallback
            state.webexApp.context.on('meeting', handleMeetingChange);
        }
        
        // Poll for meeting state periodically
        state.meetingCheckTimer = setInterval(checkMeetingState, CONFIG.meetingCheckInterval);
        
        // Poll for call state (to detect mic changes during calls)
        state.callPollTimer = setInterval(checkCallState, CONFIG.callPollInterval);
        
        // Start periodic status sync to ensure bridge is always up to date
        state.statusSyncTimer = setInterval(() => {
            if (state.isConnected && state.autoSync && state.currentStatus) {
                syncStatusToDisplay();
            }
        }, CONFIG.statusSyncInterval);
        
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
    if (!call) return;
    
    logActivity('info', `Call state: ${call.state || 'unknown'}`);
    
    if (call.state === 'Started' || call.state === 'Connected') {
        state.isInCall = true;
        setStatus('meeting', true);
        
        // Extract mic mute state from SDK if available
        if (call.localParticipant && call.localParticipant.isMuted !== undefined) {
            const wasMuted = state.micMuted;
            state.micMuted = call.localParticipant.isMuted;
            
            if (wasMuted !== state.micMuted) {
                updateMicToggle();
                logActivity('info', `Mic from SDK: ${state.micMuted ? 'muted' : 'on'}`);
            }
        }
        
        // Sync status with extracted state
        if (state.autoSync && state.isConnected) {
            syncStatusToDisplay();
        }
    } else if (call.state === 'Ended' || call.state === 'Disconnected') {
        state.isInCall = false;
        logActivity('info', 'Call ended');
        // Optionally set status back to available
        // setStatus('active', true);
    }
}

function handleViewStateChange(viewState) {
    logActivity('info', `View state: ${viewState}`);
}

/**
 * Poll active calls via Sidebar API to detect mic state changes
 * This is needed because the SDK doesn't always fire events for mute changes
 */
async function checkCallState() {
    if (!state.webexApp || !state.isInitialized) return;
    
    try {
        // Get sidebar context (v2.x SDK)
        let sidebar = null;
        
        if (state.webexApp.context && state.webexApp.context.getSidebar) {
            sidebar = await state.webexApp.context.getSidebar().catch(() => null);
        }
        
        if (!sidebar || !sidebar.getCalls) return;
        
        const callsResult = await sidebar.getCalls().catch(() => null);
        if (!callsResult) return;
        
        // Handle both array and object with items property
        const calls = Array.isArray(callsResult) ? callsResult : (callsResult.items || []);
        
        if (calls.length > 0) {
            // Find an active call
            const activeCall = calls.find(c => 
                c.state === 'Connected' || c.state === 'Started' || c.state === 'Connecting'
            );
            
            if (activeCall) {
                const wasInCall = state.isInCall;
                state.isInCall = true;
                
                // Update mic state from call's local participant
                if (activeCall.localParticipant && activeCall.localParticipant.isMuted !== undefined) {
                    const wasMuted = state.micMuted;
                    state.micMuted = activeCall.localParticipant.isMuted;
                    
                    // Only sync if state changed
                    if (wasMuted !== state.micMuted) {
                        updateMicToggle();
                        logActivity('info', `Mic state updated: ${state.micMuted ? 'muted' : 'on'}`);
                        if (state.autoSync && state.isConnected) {
                            syncStatusToDisplay();
                        }
                    }
                }
                
                // Set meeting status if we just entered a call
                if (!wasInCall) {
                    setStatus('meeting', true);
                }
            } else {
                // No active call found
                if (state.isInCall) {
                    state.isInCall = false;
                    logActivity('info', 'No active call detected');
                }
            }
        } else {
            // No calls at all
            if (state.isInCall) {
                state.isInCall = false;
            }
        }
    } catch (error) {
        // Sidebar API may not be available in all contexts (e.g., space tab)
        // This is expected, so we silently ignore
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
    if (!state.isConnected) {
        logActivity('error', 'Not connected');
        return false;
    }
    
    if (!state.currentStatus) {
        return false;
    }
    
    const displayStatus = mapToDisplayStatus(state.currentStatus);
    const statusData = {
        status: displayStatus,
        display_name: state.user?.displayName || 'Unknown',
        in_call: state.isInMeeting || state.isInCall,
        camera_on: state.cameraOn,
        mic_muted: state.micMuted,
        timestamp: new Date().toISOString()
    };
    
    // Use WebSocket if in bridge mode
    if (state.connectionMode === 'bridge' && state.ws && state.ws.readyState === WebSocket.OPEN) {
        try {
            state.ws.send(JSON.stringify({
                type: 'status',
                ...statusData
            }));
            
            logActivity('success', 'Status sent via WebSocket');
            updateSyncStatus(true);
            state.lastSyncTime = new Date();
            return true;
        } catch (error) {
            logActivity('error', `WebSocket send failed: ${error.message}`);
            updateSyncStatus(false);
            return false;
        }
    }
    
    // Fall back to HTTP for direct mode
    if (!state.displayAddress) {
        logActivity('error', 'No display address configured');
        return false;
    }
    
    try {
        const response = await fetchWithTimeout(`http://${state.displayAddress}/api/embedded/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...statusData,
                displayName: statusData.display_name,
                source: 'embedded-app'
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
    if (!state.isConnected) return;
    
    try {
        // Use WebSocket command if in bridge mode
        if (state.connectionMode === 'bridge' && state.wsPeerConnected) {
            const data = await sendBridgeCommand('get_status');
            updateDisplayStatusFromBridge(data);
            return;
        }
        
        // Fall back to HTTP for direct mode
        if (!state.displayAddress) return;
        
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
    if (!state.isConnected) return;
    
    try {
        // Use WebSocket command if in bridge mode
        if (state.connectionMode === 'bridge' && state.wsPeerConnected) {
            const data = await sendBridgeCommand('get_config');
            updateDisplayConfigFromBridge(data);
            return;
        }
        
        // Fall back to HTTP for direct mode
        if (!state.displayAddress) return;
        
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
    // Connection mode tabs
    document.getElementById('mode-bridge-btn')?.addEventListener('click', () => {
        document.getElementById('mode-bridge-btn').classList.add('active');
        document.getElementById('mode-direct-btn').classList.remove('active');
        document.getElementById('bridge-mode').style.display = 'block';
        document.getElementById('direct-mode').style.display = 'none';
    });
    
    document.getElementById('mode-direct-btn')?.addEventListener('click', () => {
        document.getElementById('mode-direct-btn').classList.add('active');
        document.getElementById('mode-bridge-btn').classList.remove('active');
        document.getElementById('direct-mode').style.display = 'block';
        document.getElementById('bridge-mode').style.display = 'none';
    });
    
    // Bridge connection button
    document.getElementById('connect-bridge-btn')?.addEventListener('click', () => {
        const bridgeUrl = document.getElementById('bridge-url').value;
        const pairingCode = document.getElementById('pairing-code').value;
        if (bridgeUrl && pairingCode) {
            connectToBridge(bridgeUrl, pairingCode);
        } else {
            const errorEl = document.getElementById('connection-error');
            errorEl.textContent = 'Please enter both bridge URL and pairing code';
            errorEl.style.display = 'block';
        }
    });
    
    // Bridge URL enter key
    document.getElementById('bridge-url')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('pairing-code').focus();
        }
    });
    
    // Pairing code enter key
    document.getElementById('pairing-code')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('connect-bridge-btn').click();
        }
    });
    
    // Setup screen - direct connect button
    document.getElementById('connect-btn')?.addEventListener('click', () => {
        const address = document.getElementById('display-address').value;
        if (address) {
            connectToDisplay(address);
        }
    });
    
    // Setup screen - enter key for direct mode
    document.getElementById('display-address')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('connect-btn').click();
        }
    });
    
    // Disconnect button
    document.getElementById('disconnect-display')?.addEventListener('click', () => {
        if (confirm('Disconnect from this display?')) {
            if (state.connectionMode === 'bridge') {
                disconnectBridge();
            } else {
                disconnectDisplay();
            }
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
    if (!state.isConnected) {
        logActivity('error', 'Not connected to display');
        return;
    }
    
    try {
        // Use WebSocket command if in bridge mode
        if (state.connectionMode === 'bridge' && state.wsPeerConnected) {
            const result = await sendBridgeCommand('set_config', data);
            logActivity('success', 'Configuration saved via bridge');
            // Update local state with returned config
            if (result) {
                updateDisplayConfigFromBridge(result);
            }
            return;
        }
        
        // Fall back to HTTP for direct mode
        if (!state.displayAddress) {
            logActivity('error', 'No display address configured');
            return;
        }
        
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
        logActivity('error', `Failed to save config: ${error.message}`);
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
    if (!state.isConnected) return;
    if (!confirm('Reboot the display?')) return;
    
    try {
        // Use WebSocket command if in bridge mode
        if (state.connectionMode === 'bridge' && state.wsPeerConnected) {
            await sendBridgeCommand('reboot');
            logActivity('info', 'Rebooting via bridge...');
            return;
        }
        
        if (!state.displayAddress) return;
        await fetch(`http://${state.displayAddress}/api/reboot`, { method: 'POST' });
        logActivity('info', 'Rebooting...');
    } catch (error) {
        logActivity('error', 'Reboot failed');
    }
}

async function factoryReset() {
    if (!state.isConnected) return;
    if (!confirm('Factory reset? All settings will be erased!')) return;
    if (!confirm('This cannot be undone. Continue?')) return;
    
    try {
        // Use WebSocket command if in bridge mode
        if (state.connectionMode === 'bridge' && state.wsPeerConnected) {
            await sendBridgeCommand('factory_reset');
            logActivity('info', 'Factory reset via bridge...');
            return;
        }
        
        if (!state.displayAddress) return;
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

/**
 * Clean up all timers and connections
 */
function cleanupAllTimers() {
    if (state.meetingCheckTimer) {
        clearInterval(state.meetingCheckTimer);
        state.meetingCheckTimer = null;
    }
    if (state.statusPollTimer) {
        clearInterval(state.statusPollTimer);
        state.statusPollTimer = null;
    }
    if (state.callPollTimer) {
        clearInterval(state.callPollTimer);
        state.callPollTimer = null;
    }
    if (state.statusSyncTimer) {
        clearInterval(state.statusSyncTimer);
        state.statusSyncTimer = null;
    }
    if (state.wsPingTimer) {
        clearInterval(state.wsPingTimer);
        state.wsPingTimer = null;
    }
    if (state.wsReconnectTimer) {
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = null;
    }
}

window.addEventListener('beforeunload', () => {
    cleanupAllTimers();
    
    // Stop listening for SDK events if possible
    if (state.webexApp && state.webexApp.stopListening) {
        try {
            state.webexApp.stopListening();
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
});
