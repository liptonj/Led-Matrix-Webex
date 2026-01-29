/**
 * @file main_sim.cpp
 * @brief Native Simulation Entry Point
 * 
 * This file provides the main() function for running the firmware logic
 * in a native simulation environment without actual hardware.
 * 
 * Usage:
 *   pio run -e native
 *   .pio/build/native/program
 * 
 * The simulation:
 * - Outputs display text to console instead of LED matrix
 * - Simulates WiFi as always connected
 * - Stores preferences in memory (not persisted between runs)
 * - Logs all operations to stdout for debugging
 */

#include <cstdio>
#include <cstdlib>
#include <csignal>
#include <atomic>

// Include mock globals first
#include "mocks/globals.cpp"

// Include application headers
#include "config/config_manager.h"
#include "display/matrix_display.h"

// ============================================================================
// Simulation State
// ============================================================================

static std::atomic<bool> g_running(true);
static unsigned long g_simulation_time = 0;

// Signal handler for graceful shutdown
void signal_handler(int signum) {
    printf("\n[SIM] Received signal %d, shutting down...\n", signum);
    g_running = false;
}

// ============================================================================
// Simulated Components
// ============================================================================

// Global instances (matching main.cpp structure)
ConfigManager config_manager;
MatrixDisplay matrix_display;

// Use shared AppState definition
#include "app_state.h"

// Application state instance
AppState app_state;

// Additional simulation-only state for display
String sim_air_quality_text = "good";

// Initialize simulation state
void init_simulation_state() {
    app_state.wifi_connected = true;  // Simulate connected by default
    app_state.webex_authenticated = false;
    app_state.xapi_connected = false;
    app_state.mqtt_connected = false;
    app_state.webex_status = "active";
    app_state.camera_on = false;
    app_state.mic_muted = false;
    app_state.in_call = false;
    app_state.temperature = 22.5f;
    app_state.humidity = 45.0f;
    app_state.door_status = "closed";
    app_state.air_quality_index = 50;  // Good air quality
    app_state.last_poll_time = 0;
    app_state.last_ota_check = 0;
    app_state.time_synced = true;
}

// ============================================================================
// Simulation Commands
// ============================================================================

void print_help() {
    printf("\n");
    printf("=== Webex Display Simulation Commands ===\n");
    printf("  status <active|away|dnd|busy|meeting|offline>  - Set Webex status\n");
    printf("  camera <on|off>                                 - Toggle camera\n");
    printf("  mic <muted|unmuted>                             - Toggle microphone\n");
    printf("  call <start|end>                                - Toggle call state\n");
    printf("  temp <value>                                    - Set temperature (F)\n");
    printf("  humidity <value>                                - Set humidity (%%)\n");
    printf("  door <open|closed>                              - Set door status\n");
    printf("  wifi <on|off>                                   - Toggle WiFi connection\n");
    printf("  display                                         - Dump display state\n");
    printf("  config                                          - Show configuration\n");
    printf("  help                                            - Show this help\n");
    printf("  quit                                            - Exit simulation\n");
    printf("\n");
}

void process_command(const char* cmd) {
    String command(cmd);
    command.trim();
    
    if (command.isEmpty()) {
        return;
    }
    
    // Parse command and argument
    int space_idx = command.indexOf(' ');
    String action = (space_idx > 0) ? command.substring(0, space_idx) : command;
    String arg = (space_idx > 0) ? command.substring(space_idx + 1) : "";
    arg.trim();
    action.toLowerCase();
    
    if (action == "quit" || action == "exit" || action == "q") {
        g_running = false;
        return;
    }
    
    if (action == "help" || action == "h" || action == "?") {
        print_help();
        return;
    }
    
    if (action == "status") {
        if (arg == "active" || arg == "away" || arg == "dnd" || 
            arg == "busy" || arg == "meeting" || arg == "offline" ||
            arg == "DoNotDisturb" || arg == "OutOfOffice") {
            app_state.webex_status = arg;
            printf("[SIM] Status set to: %s\n", arg.c_str());
        } else {
            printf("[SIM] Invalid status. Use: active, away, dnd, busy, meeting, offline\n");
        }
        return;
    }
    
    if (action == "camera") {
        if (arg == "on") {
            app_state.camera_on = true;
            app_state.xapi_connected = true;
            printf("[SIM] Camera ON\n");
        } else if (arg == "off") {
            app_state.camera_on = false;
            printf("[SIM] Camera OFF\n");
        } else {
            printf("[SIM] Usage: camera <on|off>\n");
        }
        return;
    }
    
    if (action == "mic") {
        if (arg == "muted") {
            app_state.mic_muted = true;
            app_state.xapi_connected = true;
            printf("[SIM] Microphone MUTED\n");
        } else if (arg == "unmuted") {
            app_state.mic_muted = false;
            printf("[SIM] Microphone UNMUTED\n");
        } else {
            printf("[SIM] Usage: mic <muted|unmuted>\n");
        }
        return;
    }
    
    if (action == "call") {
        if (arg == "start") {
            app_state.in_call = true;
            app_state.xapi_connected = true;
            printf("[SIM] Call STARTED\n");
        } else if (arg == "end") {
            app_state.in_call = false;
            printf("[SIM] Call ENDED\n");
        } else {
            printf("[SIM] Usage: call <start|end>\n");
        }
        return;
    }
    
    if (action == "temp") {
        float temp_f = arg.toFloat();
        if (temp_f != 0 || arg == "0") {
            // Convert Fahrenheit to Celsius for internal storage
            // Display will convert back to Fahrenheit
            app_state.temperature = (temp_f - 32.0f) * 5.0f / 9.0f;
            app_state.mqtt_connected = true;
            printf("[SIM] Temperature set to: %.1f°F\n", temp_f);
        } else {
            printf("[SIM] Usage: temp <value>\n");
        }
        return;
    }
    
    if (action == "humidity") {
        float humid = arg.toFloat();
        if (humid != 0 || arg == "0") {
            app_state.humidity = humid;
            app_state.mqtt_connected = true;
            printf("[SIM] Humidity set to: %.1f%%\n", humid);
        } else {
            printf("[SIM] Usage: humidity <value>\n");
        }
        return;
    }
    
    if (action == "door") {
        if (arg == "open" || arg == "closed") {
            app_state.door_status = arg;
            app_state.mqtt_connected = true;
            printf("[SIM] Door: %s\n", arg.c_str());
        } else {
            printf("[SIM] Usage: door <open|closed>\n");
        }
        return;
    }
    
    if (action == "wifi") {
        if (arg == "on") {
            app_state.wifi_connected = true;
            WiFi.setSimulateConnected(true);
            printf("[SIM] WiFi CONNECTED\n");
        } else if (arg == "off") {
            app_state.wifi_connected = false;
            WiFi.setSimulateConnected(false);
            printf("[SIM] WiFi DISCONNECTED\n");
        } else {
            printf("[SIM] Usage: wifi <on|off>\n");
        }
        return;
    }
    
    
    if (action == "display") {
        printf("\n=== Current Display State ===\n");
        printf("  WiFi: %s\n", app_state.wifi_connected ? "Connected" : "Disconnected");
        printf("  Webex Status: %s\n", app_state.webex_status.c_str());
        printf("  xAPI Connected: %s\n", app_state.xapi_connected ? "Yes" : "No");
        printf("  In Call: %s\n", app_state.in_call ? "Yes" : "No");
        printf("  Camera: %s\n", app_state.camera_on ? "ON" : "OFF");
        printf("  Microphone: %s\n", app_state.mic_muted ? "MUTED" : "Unmuted");
        printf("  MQTT Connected: %s\n", app_state.mqtt_connected ? "Yes" : "No");
        printf("  Temperature: %.1f C\n", app_state.temperature);
        printf("  Humidity: %.1f%%\n", app_state.humidity);
        printf("  Door: %s\n", app_state.door_status.c_str());
        printf("  Air Quality Index: %d (%s)\n", app_state.air_quality_index, sim_air_quality_text.c_str());
        printf("==============================\n\n");
        return;
    }
    
    if (action == "config") {
        printf("\n=== Configuration ===\n");
        printf("  Device Name: %s\n", config_manager.getDeviceName().c_str());
        printf("  Display Name: %s\n", config_manager.getDisplayName().c_str());
        printf("  Brightness: %d\n", config_manager.getBrightness());
        printf("  Poll Interval: %d seconds\n", config_manager.getWebexPollInterval());
        printf("  Has WiFi Credentials: %s\n", config_manager.hasWiFiCredentials() ? "Yes" : "No");
        printf("  Has Webex Credentials: %s\n", config_manager.hasWebexCredentials() ? "Yes" : "No");
        printf("  Has Webex Tokens: %s\n", config_manager.hasWebexTokens() ? "Yes" : "No");
        printf("  Has MQTT Config: %s\n", config_manager.hasMQTTConfig() ? "Yes" : "No");
        printf("=====================\n\n");
        return;
    }
    
    printf("[SIM] Unknown command: %s (type 'help' for available commands)\n", action.c_str());
}

// ============================================================================
// Main Simulation Loop
// ============================================================================

void update_display() {
    // Build display data same as real firmware
    DisplayData data;
    data.webex_status = app_state.webex_status;
    data.display_name = config_manager.getDisplayName();
    data.camera_on = app_state.camera_on;
    data.mic_muted = app_state.mic_muted;
    data.in_call = app_state.in_call;
    data.show_call_status = app_state.xapi_connected;
    data.temperature = app_state.temperature;
    data.humidity = app_state.humidity;
    data.door_status = app_state.door_status;
    data.air_quality_index = app_state.air_quality_index;
    data.show_sensors = app_state.mqtt_connected;
    data.wifi_connected = app_state.wifi_connected;
    
    matrix_display.update(data);
}

int main(int argc, char* argv[]) {
    // Setup signal handlers
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    
    printf("\n");
    printf("╔══════════════════════════════════════════════════════════════╗\n");
    printf("║         Webex Status Display - Native Simulation             ║\n");
    printf("║                                                              ║\n");
    printf("║  This simulation runs the firmware logic without hardware.   ║\n");
    printf("║  All display output is printed to the console.               ║\n");
    printf("║                                                              ║\n");
    printf("║  Type 'help' for available commands, 'quit' to exit.         ║\n");
    printf("╚══════════════════════════════════════════════════════════════╝\n");
    printf("\n");
    
    // ========================================================================
    // Setup Phase (mirrors real setup())
    // ========================================================================
    
    // Initialize simulation state
    init_simulation_state();
    
    Serial.begin(115200);
    delay(100);
    
    Serial.println();
    Serial.println("===========================================");
    Serial.println("  Webex Status Display - SIMULATION MODE");
    Serial.printf("  Firmware Version: %s\n", FIRMWARE_VERSION);
    Serial.println("===========================================");
    Serial.println();
    
    // Initialize configuration
    Serial.println("[INIT] Loading configuration...");
    if (!config_manager.begin()) {
        Serial.println("[ERROR] Failed to initialize configuration!");
    }
    
    // Initialize display (simulated)
    Serial.println("[INIT] Initializing LED matrix (simulated)...");
    if (!matrix_display.begin()) {
        Serial.println("[ERROR] Failed to initialize display!");
    }
    matrix_display.showStartupScreen(FIRMWARE_VERSION);
    
    // Simulate WiFi already connected
    Serial.println("[INIT] Setting up WiFi (simulated as connected)...");
    WiFi.setSimulateConnected(true);
    app_state.wifi_connected = true;
    Serial.printf("[WIFI] Connected! IP: %s (simulated)\n", WiFi.localIP().toString().c_str());
    
    // Show initial state
    matrix_display.showConnected(WiFi.localIP().toString());
    delay(500);  // Brief pause to see startup
    
    Serial.println("[INIT] Setup complete!");
    Serial.println();
    
    print_help();
    
    // ========================================================================
    // Main Loop (non-blocking command processing)
    // ========================================================================
    
    char input_buffer[256];
    unsigned long last_update = 0;
    unsigned long loop_count = 0;
    
    printf("\nsim> ");
    fflush(stdout);
    
    while (g_running) {
        // Check for user input (non-blocking on some systems)
        // For simplicity, we use fgets which blocks
        // In a more advanced simulation, you'd use select() or threads
        
        if (fgets(input_buffer, sizeof(input_buffer), stdin) != nullptr) {
            // Remove newline
            input_buffer[strcspn(input_buffer, "\n")] = 0;
            
            process_command(input_buffer);
            
            // Update display after command
            if (g_running) {
                update_display();
                printf("\nsim> ");
                fflush(stdout);
            }
        }
        
        loop_count++;
    }
    
    // ========================================================================
    // Shutdown
    // ========================================================================
    
    printf("\n[SIM] Simulation ended after %lu iterations.\n", loop_count);
    printf("[SIM] Goodbye!\n\n");
    
    return 0;
}
