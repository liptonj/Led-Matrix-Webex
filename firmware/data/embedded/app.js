/**
 * LED Matrix Display - Webex Embedded App
 * 
 * This embedded app integrates with Webex to detect meeting state
 * and allows manual status selection to push to LED matrix displays.
 * 
 * The app is hosted directly on the ESP32 display.
 * 
 * Webex Embedded Apps SDK Capabilities:
 * - context.getUser() - Get user info (name, email)
 * - context.getMeeting() - Detect if user is in a meeting
 * - Event listeners for meeting state changes
 * 
 * Note: Full presence status (available/away/DND) is NOT available
 * in the Embedded Apps SDK. Users can manually select their status
 * or rely on the ESP32's direct OAuth integration for auto-polling.
 */

/* global Webex */

// Configuration
const CONFIG = {
    // Local display API endpoint (same origin)
    localStatusEndpoint: '/api/embedded/status',
    // Storage key for additional displays
    displaysStorageKey: 'webex_displays',
    // Max log entries to keep
    maxLogEntries: 30,
    // Retry settings
    maxRetries: 3,
    retryDelayMs: 2000,
    // Meeting check interval (for detecting when meeting ends)
    meetingCheckInterval: 10000
};

// Application State
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
    meetingCheckTimer: null
};

/**
 * Initialize the Webex Embedded App
 */
async function initializeApp() {
    logActivity('info', 'Initializing Webex Embedded App...');
    updateDisplayHost();
    loadAdditionalDisplays();
    
    try {
        // Check if Webex SDK is available
        if (typeof Webex === 'undefined' || !Webex.Application) {
            throw new Error('Webex SDK not loaded. Make sure you are running inside Webex.');
        }
        
        // Initialize Webex Embedded App SDK
        state.webexApp = new Webex.Application();
        
        logActivity('info', 'Waiting for Webex app to be ready...');
        await state.webexApp.onReady();
        logActivity('success', 'Connected to Webex');
        
        // Get user context
        await getUserContext();
        
        // Start listening for presence changes
        await startPresenceMonitoring();
        
        // Setup event listeners
        setupEventListeners();
        
        // Update connection status
        updateConnectionStatus('connected');
        state.isInitialized = true;
        
        logActivity('success', 'App initialization complete');
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        logActivity('error', `Initialization failed: ${error.message}`);
        updateConnectionStatus('error');
        
        // Show helpful message for non-Webex environments
        if (error.message.includes('Webex SDK not loaded')) {
            document.getElementById('user-name').textContent = 'Not in Webex';
            document.getElementById('user-status').textContent = 'Open this app inside Webex';
        }
    }
}

/**
 * Get user context from Webex
 */
async function getUserContext() {
    try {
        const context = await state.webexApp.context.getUser();
        
        state.user = {
            id: context.id,
            email: context.email,
            displayName: context.displayName || context.email.split('@')[0],
            orgId: context.orgId
        };
        
        // Update UI
        updateUserDisplay();
        logActivity('info', `Signed in as ${state.user.displayName}`);
        
    } catch (error) {
        console.error('Failed to get user context:', error);
        logActivity('error', 'Could not get user information');
        throw error;
    }
}

/**
 * Start monitoring meeting state
 * Note: The Embedded Apps SDK can detect meetings but NOT general presence status
 */
async function startPresenceMonitoring() {
    logActivity('info', 'Starting meeting detection...');
    
    try {
        // Check initial meeting state
        await checkMeetingState();
        
        // Listen for meeting state changes via SDK events
        if (state.webexApp.context.on) {
            state.webexApp.context.on('meeting', (meeting) => {
                handleMeetingChange(meeting);
            });
        }
        
        // Periodic meeting check (backup for when events don't fire)
        state.meetingCheckTimer = setInterval(checkMeetingState, CONFIG.meetingCheckInterval);
        
        logActivity('success', 'Meeting detection active');
        logActivity('info', 'Select your status manually or use auto-detection in meetings');
        
    } catch (error) {
        console.error('Failed to start meeting monitoring:', error);
        logActivity('error', 'Meeting detection unavailable');
    }
    
    // Setup manual status button listeners
    setupStatusButtons();
}

/**
 * Check current meeting state
 */
async function checkMeetingState() {
    try {
        const meetingContext = await state.webexApp.context.getMeeting().catch(() => null);
        handleMeetingChange(meetingContext);
    } catch (error) {
        console.error('Meeting check failed:', error);
    }
}

/**
 * Handle meeting state changes
 */
function handleMeetingChange(meeting) {
    const wasInMeeting = state.isInMeeting;
    state.isInMeeting = meeting && (meeting.state === 'active' || meeting.id);
    
    const meetingStatusEl = document.getElementById('meeting-status');
    
    if (state.isInMeeting) {
        meetingStatusEl.style.display = 'flex';
        
        if (!wasInMeeting) {
            logActivity('info', 'Meeting detected - auto-setting status to "In a Call"');
            setStatus('meeting', true);
        }
    } else {
        meetingStatusEl.style.display = 'none';
        
        if (wasInMeeting) {
            logActivity('info', 'Meeting ended');
            // Optionally revert to previous status or stay as is
        }
    }
}

/**
 * Setup manual status button click handlers
 */
function setupStatusButtons() {
    const buttons = document.querySelectorAll('.status-btn');
    
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            setStatus(status, false);
            
            // Update UI to show selected button
            buttons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
}

/**
 * Set status (manual or auto from meeting detection)
 */
function setStatus(status, autoDetected = false) {
    updatePresence({
        status: status,
        displayName: state.user?.displayName,
        autoDetected: autoDetected
    });
}

/**
 * Update presence status
 */
function updatePresence(presence) {
    state.previousStatus = state.currentStatus;
    state.currentStatus = presence.status?.toLowerCase() || 'unknown';
    
    // Update UI
    const statusEl = document.getElementById('user-status');
    const avatarEl = document.getElementById('presence-avatar');
    
    statusEl.textContent = formatStatus(state.currentStatus);
    
    // Update avatar status class
    avatarEl.className = 'presence-avatar ' + state.currentStatus;
    
    // Log status change
    if (state.previousStatus !== state.currentStatus) {
        logActivity('info', `Status: ${formatStatus(state.currentStatus)}`);
        
        // Auto-sync if enabled
        if (state.autoSync && state.isInitialized) {
            syncStatusToAllDisplays();
        }
    }
}

/**
 * Format status for display
 */
function formatStatus(status) {
    const statusMap = {
        'active': 'Available',
        'available': 'Available',
        'away': 'Away',
        'inactive': 'Away',
        'busy': 'In a Call',
        'call': 'In a Call',
        'dnd': 'Do Not Disturb',
        'donotdisturb': 'Do Not Disturb',
        'meeting': 'In a Meeting',
        'oncall': 'In a Call',
        'outofoffice': 'Out of Office',
        'ooo': 'Out of Office',
        'offline': 'Offline',
        'pending': 'Pending',
        'unknown': 'Unknown'
    };
    
    return statusMap[status?.toLowerCase()] || status || 'Unknown';
}

/**
 * Map internal status to display status
 */
function mapToDisplayStatus(status) {
    const displayMap = {
        'active': 'active',
        'available': 'active',
        'away': 'away',
        'inactive': 'away',
        'busy': 'meeting',
        'call': 'meeting',
        'dnd': 'dnd',
        'donotdisturb': 'dnd',
        'meeting': 'meeting',
        'oncall': 'meeting',
        'outofoffice': 'ooo',
        'ooo': 'ooo',
        'offline': 'offline'
    };
    
    return displayMap[status?.toLowerCase()] || 'unknown';
}

/**
 * Update user display in UI
 */
function updateUserDisplay() {
    if (!state.user) return;
    
    const nameEl = document.getElementById('user-name');
    const initialEl = document.getElementById('user-initial');
    
    nameEl.textContent = state.user.displayName;
    initialEl.textContent = state.user.displayName.charAt(0).toUpperCase();
}

/**
 * Update display host info
 */
function updateDisplayHost() {
    const hostEl = document.getElementById('display-host');
    hostEl.textContent = state.localHost;
}

/**
 * Sync status to all configured displays
 */
async function syncStatusToAllDisplays() {
    if (!state.currentStatus) {
        logActivity('error', 'No status to sync');
        return;
    }
    
    const displayStatus = mapToDisplayStatus(state.currentStatus);
    
    // Sync to local display (this device)
    const localResult = await syncStatusToDisplay(null, displayStatus);
    
    // Sync to additional displays
    const additionalResults = await Promise.allSettled(
        state.additionalDisplays.map(display => 
            syncStatusToDisplay(display.host, displayStatus)
        )
    );
    
    // Update sync status UI
    const allSuccessful = localResult && 
        additionalResults.every(r => r.status === 'fulfilled' && r.value);
    
    updateSyncStatus(allSuccessful);
    
    if (allSuccessful) {
        state.lastSyncTime = new Date();
        updateLastSyncTime();
    }
}

/**
 * Sync status to a specific display
 * @param {string|null} host - Display host (null for local)
 * @param {string} status - Status to send
 * @returns {Promise<boolean>} Success status
 */
async function syncStatusToDisplay(host, status) {
    const isLocal = host === null;
    const displayName = isLocal ? 'local display' : host;
    
    try {
        const url = isLocal 
            ? CONFIG.localStatusEndpoint 
            : `http://${host}/api/embedded/status`;
        
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: status,
                displayName: state.user?.displayName || 'Unknown',
                source: 'embedded-app',
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            logActivity('success', `Synced to ${displayName}`);
            
            // Update display item status if not local
            if (!isLocal) {
                updateDisplayItemStatus(host, 'synced');
            }
            
            return true;
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
        
    } catch (error) {
        logActivity('error', `Failed to sync to ${displayName}: ${error.message}`);
        
        if (!isLocal) {
            updateDisplayItemStatus(host, 'error');
        }
        
        return false;
    }
}

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(url, options, retries = CONFIG.maxRetries) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            return response;
            
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(r => setTimeout(r, CONFIG.retryDelayMs * (i + 1)));
        }
    }
}

/**
 * Update sync status display
 */
function updateSyncStatus(success) {
    const syncStatusEl = document.getElementById('sync-status');
    
    if (success) {
        syncStatusEl.className = 'sync-status success';
        syncStatusEl.innerHTML = '<span class="icon">✓</span><span class="text">Status synced to display(s)</span>';
    } else {
        syncStatusEl.className = 'sync-status error';
        syncStatusEl.innerHTML = '<span class="icon">✗</span><span class="text">Some displays failed to sync</span>';
    }
}

/**
 * Update last sync time display
 */
function updateLastSyncTime() {
    const timeEl = document.getElementById('last-sync-time');
    if (state.lastSyncTime) {
        timeEl.textContent = state.lastSyncTime.toLocaleTimeString();
    }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
    const indicator = document.getElementById('connection-status');
    const text = indicator.querySelector('.text');
    
    indicator.className = 'status-indicator ' + status;
    
    const statusText = {
        'connected': 'Connected',
        'error': 'Not Connected',
        'disconnected': 'Disconnected'
    };
    
    text.textContent = statusText[status] || 'Unknown';
}

// ============ Additional Displays Management ============

/**
 * Load additional displays from storage
 */
function loadAdditionalDisplays() {
    try {
        const stored = localStorage.getItem(CONFIG.displaysStorageKey);
        if (stored) {
            state.additionalDisplays = JSON.parse(stored);
            renderDisplaysList();
        }
    } catch (error) {
        console.error('Failed to load displays from storage:', error);
        state.additionalDisplays = [];
    }
}

/**
 * Save additional displays to storage
 */
function saveAdditionalDisplays() {
    try {
        localStorage.setItem(CONFIG.displaysStorageKey, JSON.stringify(state.additionalDisplays));
    } catch (error) {
        console.error('Failed to save displays to storage:', error);
    }
}

/**
 * Add a new display
 */
function addDisplay(host) {
    // Validate host
    host = host.trim();
    if (!host) {
        logActivity('error', 'Display address is required');
        return false;
    }
    
    // Check for duplicates
    if (state.additionalDisplays.some(d => d.host === host)) {
        logActivity('error', 'Display already added');
        return false;
    }
    
    state.additionalDisplays.push({
        host: host,
        addedAt: new Date().toISOString(),
        lastStatus: 'pending'
    });
    
    saveAdditionalDisplays();
    renderDisplaysList();
    logActivity('success', `Added display: ${host}`);
    
    return true;
}

/**
 * Remove a display
 */
function removeDisplay(host) {
    state.additionalDisplays = state.additionalDisplays.filter(d => d.host !== host);
    saveAdditionalDisplays();
    renderDisplaysList();
    logActivity('info', `Removed display: ${host}`);
}

/**
 * Render the displays list
 */
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
    
    listEl.innerHTML = state.additionalDisplays.map(display => `
        <div class="display-item" data-host="${display.host}">
            <div class="display-item-info">
                <span class="display-item-host">${display.host}</span>
                <span class="display-item-status" id="display-status-${encodeId(display.host)}">
                    ${display.lastStatus === 'synced' ? '✓ Synced' : 
                      display.lastStatus === 'error' ? '✗ Error' : '⏳ Pending'}
                </span>
            </div>
            <div class="display-item-actions">
                <button class="btn-icon btn-danger remove-display" data-host="${display.host}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
    
    // Add remove button listeners
    listEl.querySelectorAll('.remove-display').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const host = e.currentTarget.dataset.host;
            if (confirm(`Remove display ${host}?`)) {
                removeDisplay(host);
            }
        });
    });
}

/**
 * Update display item status
 */
function updateDisplayItemStatus(host, status) {
    const display = state.additionalDisplays.find(d => d.host === host);
    if (display) {
        display.lastStatus = status;
    }
    
    const statusEl = document.getElementById(`display-status-${encodeId(host)}`);
    if (statusEl) {
        statusEl.className = `display-item-status ${status}`;
        statusEl.textContent = status === 'synced' ? '✓ Synced' : 
                               status === 'error' ? '✗ Error' : '⏳ Pending';
    }
}

/**
 * Encode host for use as element ID
 */
function encodeId(host) {
    return host.replace(/[^a-zA-Z0-9]/g, '_');
}

// ============ Event Listeners ============

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Add display button
    document.getElementById('add-display').addEventListener('click', () => {
        document.getElementById('add-display-form').style.display = 'block';
        document.getElementById('new-display-host').focus();
    });
    
    // Cancel add display
    document.getElementById('cancel-add-display').addEventListener('click', () => {
        document.getElementById('add-display-form').style.display = 'none';
        document.getElementById('new-display-host').value = '';
    });
    
    // Save new display
    document.getElementById('save-display').addEventListener('click', () => {
        const host = document.getElementById('new-display-host').value;
        if (addDisplay(host)) {
            document.getElementById('add-display-form').style.display = 'none';
            document.getElementById('new-display-host').value = '';
        }
    });
    
    // Enter key in host input
    document.getElementById('new-display-host').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('save-display').click();
        }
    });
    
    // Auto-sync toggle
    document.getElementById('auto-sync').addEventListener('change', (e) => {
        state.autoSync = e.target.checked;
        logActivity('info', state.autoSync ? 'Auto-sync enabled' : 'Auto-sync disabled');
    });
}

// ============ Activity Log ============

/**
 * Add entry to activity log
 */
function logActivity(type, message) {
    const logEl = document.getElementById('activity-log');
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
        <span class="time">${time}</span>
        <span class="message">${message}</span>
    `;
    
    // Insert at top
    if (logEl.firstChild) {
        logEl.insertBefore(entry, logEl.firstChild);
    } else {
        logEl.appendChild(entry);
    }
    
    // Limit entries
    while (logEl.children.length > CONFIG.maxLogEntries) {
        logEl.removeChild(logEl.lastChild);
    }
    
    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ============ Initialization ============

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);
