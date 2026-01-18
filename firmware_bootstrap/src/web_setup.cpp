/**
 * @file web_setup.cpp
 * @brief Minimal Web Server Implementation
 */

#include "web_setup.h"
#include <ArduinoJson.h>
#include <WiFi.h>

WebSetup::WebSetup()
    : server(nullptr)
    , dns_server(nullptr)
    , config_store(nullptr)
    , wifi_provisioner(nullptr)
    , ota_downloader(nullptr)
    , ota_pending(false)
    , wifi_pending(false)
    , running(false)
    , captive_portal_active(false) {
}

WebSetup::~WebSetup() {
    stop();
}

void WebSetup::stop() {
    if (server) {
        server->end();
        delete server;
        server = nullptr;
    }
    if (dns_server) {
        dns_server->stop();
        delete dns_server;
        dns_server = nullptr;
    }
    running = false;
    captive_portal_active = false;
    Serial.println("[WEB] Web server stopped");
}

bool WebSetup::isRunning() const {
    return running;
}

void WebSetup::begin(ConfigStore* config, WiFiProvisioner* wifi, OTADownloader* ota) {
    // Prevent double initialization
    if (running) {
        Serial.println("[WEB] Web server already running, skipping initialization");
        return;
    }

    config_store = config;
    wifi_provisioner = wifi;
    ota_downloader = ota;

    // Initialize LittleFS for static files
    if (!LittleFS.begin(true)) {
        Serial.println("[WEB] Failed to mount LittleFS, using embedded HTML");
    }

    // Create server on port 80
    server = new AsyncWebServer(80);

    // Setup routes
    setupRoutes();

    // Setup captive portal only if AP is active
    if (wifi_provisioner && wifi_provisioner->isAPActive()) {
        setupCaptivePortal();
    } else {
        Serial.println("[WEB] Skipping captive portal (AP not active)");
    }

    // Start server
    server->begin();
    running = true;

    Serial.println("[WEB] Bootstrap web server started on port 80");
}

void WebSetup::loop() {
    // Process DNS requests for captive portal
    if (dns_server && captive_portal_active) {
        dns_server->processNextRequest();
    }
}

void WebSetup::setupCaptivePortal() {
    // Verify AP IP is valid before starting DNS
    IPAddress ap_ip = WiFi.softAPIP();
    if (ap_ip == IPAddress(0, 0, 0, 0)) {
        Serial.println("[WEB] Cannot start captive portal - AP IP is 0.0.0.0");
        return;
    }

    // Start DNS server for captive portal (redirect all DNS to our IP)
    dns_server = new DNSServer();

    // Start DNS server - redirect all domains to the AP IP
    if (dns_server->start(DNS_PORT, "*", ap_ip)) {
        captive_portal_active = true;
        Serial.println("[WEB] Captive portal DNS started");
        Serial.printf("[WEB] All DNS queries will redirect to %s\n",
                      ap_ip.toString().c_str());
    } else {
        Serial.println("[WEB] Failed to start captive portal DNS");
        delete dns_server;
        dns_server = nullptr;
    }
}

void WebSetup::setupRoutes() {
    // Serve static files from LittleFS if available
    if (LittleFS.exists("/index.html")) {
        server->serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
    } else {
        // Serve embedded HTML if LittleFS not available
        server->on("/", HTTP_GET, [this](AsyncWebServerRequest* request) {
            handleRoot(request);
        });
    }

    // API endpoints
    server->on("/api/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleStatus(request);
    });

    server->on("/api/config", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleConfig(request);
    });

    server->on("/api/scan", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleScan(request);
    });

    server->on("/api/wifi", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleWifiSave(request, data, len);
        }
    );

    server->on("/api/ota-url", HTTP_POST,
        [](AsyncWebServerRequest* request) {},
        nullptr,
        [this](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
            handleOTAUrl(request, data, len);
        }
    );

    server->on("/api/start-ota", HTTP_POST, [this](AsyncWebServerRequest* request) {
        handleStartOTA(request);
    });

    server->on("/api/ota-progress", HTTP_GET, [this](AsyncWebServerRequest* request) {
        handleOTAProgress(request);
    });

    // Captive portal detection endpoints - redirect to setup page
    // Apple
    server->on("/hotspot-detect.html", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });
    server->on("/library/test/success.html", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Android
    server->on("/generate_204", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });
    server->on("/gen_204", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Windows
    server->on("/connecttest.txt", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });
    server->on("/ncsi.txt", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Firefox
    server->on("/success.txt", HTTP_GET, [this](AsyncWebServerRequest* request) {
        request->redirect("http://192.168.4.1/");
    });

    // Fallback - redirect any unknown request to setup page (captive portal behavior)
    server->onNotFound([this](AsyncWebServerRequest* request) {
        // If it's an API request, return 404
        if (request->url().startsWith("/api/")) {
            request->send(404, "application/json", "{\"error\":\"Not found\"}");
            return;
        }
        // Otherwise redirect to captive portal
        request->redirect("http://192.168.4.1/");
    });
}

void WebSetup::handleRoot(AsyncWebServerRequest* request) {
    // Embedded minimal HTML if LittleFS not available
    String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Webex Display Setup</title>
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,sans-serif;background:#1a1a2e;color:#eee;padding:20px}
        .container{max-width:400px;margin:0 auto}
        h1{text-align:center;margin-bottom:20px;color:#00bceb}
        .card{background:#16213e;border-radius:8px;padding:20px;margin-bottom:15px}
        h2{font-size:1.1em;margin-bottom:15px;color:#00bceb}
        .form-group{margin-bottom:15px}
        label{display:block;margin-bottom:5px;font-size:0.9em;color:#aaa}
        input,select{width:100%;padding:10px;border:1px solid #333;border-radius:4px;background:#0f0f23;color:#fff}
        input:focus{border-color:#00bceb;outline:none}
        .btn{display:block;width:100%;padding:12px;border:none;border-radius:4px;font-size:1em;cursor:pointer;margin-top:10px}
        .btn-primary{background:#00bceb;color:#000}
        .btn-primary:hover{background:#00a4d1}
        .btn-secondary{background:#333;color:#fff}
        .network-list{max-height:200px;overflow-y:auto;margin:10px 0}
        .network{padding:10px;background:#0f0f23;border-radius:4px;margin-bottom:5px;cursor:pointer;display:flex;justify-content:space-between}
        .network:hover{background:#1a1a3e}
        .progress{height:20px;background:#333;border-radius:10px;overflow:hidden;margin:10px 0}
        .progress-bar{height:100%;background:#00bceb;transition:width 0.3s}
        .status{text-align:center;padding:10px;font-size:0.9em;color:#aaa}
        .collapse{display:none}
        .collapse.show{display:block}
        .toggle{color:#00bceb;cursor:pointer;font-size:0.9em}
    </style>
</head>
<body>
    <div class="container">
        <h1>Webex Display Setup</h1>

        <div class="card">
            <h2>WiFi Configuration</h2>
            <button class="btn btn-secondary" onclick="scanNetworks()">Scan Networks</button>
            <div id="networks" class="network-list"></div>
            <form id="wifi-form" onsubmit="saveWifi(event)">
                <div class="form-group">
                    <label>SSID</label>
                    <input type="text" id="ssid" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="password">
                </div>
                <button type="submit" class="btn btn-primary">Connect</button>
            </form>
        </div>

        <div class="card">
            <h2>Firmware Update</h2>
            <div id="ota-status" class="status">Ready to install firmware</div>
            <div class="progress"><div id="progress-bar" class="progress-bar" style="width:0%"></div></div>
            <button class="btn btn-primary" onclick="startOTA()">Install Firmware</button>
            <p class="toggle" onclick="toggleAdvanced()">Advanced Options</p>
            <div id="advanced" class="collapse">
                <div class="form-group">
                    <label>Custom OTA URL (optional)</label>
                    <input type="text" id="ota-url" placeholder="Leave empty for default">
                </div>
                <button class="btn btn-secondary" onclick="saveOTAUrl()">Save URL</button>
            </div>
        </div>

        <div class="card">
            <h2>Status</h2>
            <div id="device-status" class="status">Loading...</div>
        </div>
    </div>
    <script>
        function scanNetworks(){
            document.getElementById('networks').innerHTML='Scanning...';
            fetch('/api/scan').then(r=>r.json()).then(d=>{
                let html='';
                d.networks.forEach(n=>{
                    html+=`<div class="network" onclick="selectNetwork('${n.ssid}')">
                        <span>${n.ssid}</span><span>${n.rssi}dBm ${n.encrypted?'🔒':''}</span>
                    </div>`;
                });
                document.getElementById('networks').innerHTML=html||'No networks found';
            }).catch(()=>document.getElementById('networks').innerHTML='Scan failed');
        }
        function selectNetwork(ssid){document.getElementById('ssid').value=ssid;}
        function saveWifi(e){
            e.preventDefault();
            const ssid=document.getElementById('ssid').value;
            const password=document.getElementById('password').value;
            fetch('/api/wifi',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({ssid,password})
            }).then(r=>r.json()).then(d=>{
                alert(d.message||'WiFi saved! Connecting...');
            }).catch(()=>alert('Failed to save WiFi'));
        }
        function startOTA(){
            document.getElementById('ota-status').textContent='Starting update...';
            fetch('/api/start-ota',{method:'POST'}).then(r=>r.json()).then(d=>{
                if(d.success)pollProgress();
                else document.getElementById('ota-status').textContent=d.error||'Failed';
            });
        }
        function pollProgress(){
            fetch('/api/ota-progress').then(r=>r.json()).then(d=>{
                document.getElementById('ota-status').textContent=d.message;
                document.getElementById('progress-bar').style.width=d.progress+'%';
                if(d.progress<100&&d.status!=='error')setTimeout(pollProgress,500);
            });
        }
        function saveOTAUrl(){
            const url=document.getElementById('ota-url').value;
            fetch('/api/ota-url',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({url})
            }).then(r=>r.json()).then(d=>alert(d.message||'URL saved'));
        }
        function toggleAdvanced(){
            document.getElementById('advanced').classList.toggle('show');
        }
        function loadStatus(){
            fetch('/api/status').then(r=>r.json()).then(d=>{
                let html=`WiFi: ${d.wifi_connected?'Connected':'Disconnected'}<br>`;
                html+=`IP: ${d.ip_address}<br>`;
                html+=`Version: ${d.version}`;
                document.getElementById('device-status').innerHTML=html;
            });
        }
        loadStatus();setInterval(loadStatus,5000);
    </script>
</body>
</html>
)rawliteral";

    request->send(200, "text/html", html);
}

void WebSetup::handleStatus(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["wifi_connected"] = wifi_provisioner->isConnected();
    doc["ap_active"] = wifi_provisioner->isAPActive();
    doc["smartconfig_active"] = wifi_provisioner->isSmartConfigActive();
    doc["ip_address"] = wifi_provisioner->getIPAddress().toString();
    doc["ap_ip"] = wifi_provisioner->getAPIPAddress().toString();

    #ifdef BOOTSTRAP_VERSION
    doc["version"] = BOOTSTRAP_VERSION;
    #else
    doc["version"] = "1.0.1";
    #endif

    doc["free_heap"] = ESP.getFreeHeap();
    doc["ota_url"] = config_store->getOTAUrl();

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebSetup::handleConfig(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["has_wifi"] = config_store->hasWiFi();
    doc["wifi_ssid"] = config_store->getWiFiSSID();
    doc["ota_url"] = config_store->getOTAUrl();
    doc["has_custom_ota_url"] = config_store->hasCustomOTAUrl();

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebSetup::handleScan(AsyncWebServerRequest* request) {
    int count = wifi_provisioner->scanNetworks();

    JsonDocument doc;
    JsonArray networks = doc["networks"].to<JsonArray>();

    for (int i = 0; i < count; i++) {
        JsonObject network = networks.add<JsonObject>();
        network["ssid"] = wifi_provisioner->getScannedSSID(i);
        network["rssi"] = wifi_provisioner->getScannedRSSI(i);
        network["encrypted"] = wifi_provisioner->isScannedNetworkEncrypted(i);
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

void WebSetup::handleWifiSave(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body = String((char*)data).substring(0, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    String ssid = doc["ssid"].as<String>();
    String password = doc["password"].as<String>();

    if (ssid.isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"SSID required\"}");
        return;
    }

    // Save credentials
    config_store->setWiFiCredentials(ssid, password);
    wifi_pending = true;

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"WiFi saved. Will connect shortly...\"}");
}

void WebSetup::handleOTAUrl(AsyncWebServerRequest* request, uint8_t* data, size_t len) {
    String body = String((char*)data).substring(0, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    String url = doc["url"].as<String>();
    config_store->setOTAUrl(url);

    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"OTA URL saved\"}");
}

void WebSetup::handleStartOTA(AsyncWebServerRequest* request) {
    if (!wifi_provisioner->isConnected()) {
        request->send(400, "application/json",
                      "{\"error\":\"WiFi not connected\"}");
        return;
    }

    ota_pending = true;
    request->send(200, "application/json",
                  "{\"success\":true,\"message\":\"OTA update starting...\"}");
}

void WebSetup::handleOTAProgress(AsyncWebServerRequest* request) {
    JsonDocument doc;

    doc["progress"] = ota_downloader->getProgress();
    doc["message"] = ota_downloader->getStatusMessage();

    OTAStatus status = ota_downloader->getStatus();
    if (status == OTAStatus::SUCCESS) {
        doc["status"] = "success";
    } else if (status >= OTAStatus::ERROR_NO_URL) {
        doc["status"] = "error";
    } else {
        doc["status"] = "in_progress";
    }

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
}

bool WebSetup::isOTAPending() const {
    return ota_pending;
}

void WebSetup::clearOTAPending() {
    ota_pending = false;
}

bool WebSetup::isWiFiPending() const {
    return wifi_pending;
}

void WebSetup::clearWiFiPending() {
    wifi_pending = false;
}
