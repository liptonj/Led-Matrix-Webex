/**
 * @file api_webex.cpp
 * @brief Webex OAuth API Handlers
 */

#include "web_server.h"
#include "../webex/oauth_handler.h"
#include "../auth/device_credentials.h"
#include "../common/pairing_manager.h"
#include "../supabase/supabase_client.h"
#include "../common/url_utils.h"
#include "../core/dependencies.h"
#include "../debug/log_system.h"
#include <ArduinoJson.h>

static const char* TAG = "API_WEBEX";

// Note: urlEncode() removed from anonymous namespace - now using common/url_utils.h

void WebServerManager::handleWebexAuth(AsyncWebServerRequest* request) {
    auto& deps = getDependencies();
    const String serial = deps.credentials.getSerialNumber();

    if (serial.isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"Device not ready\"}");
        return;
    }
    if (!deps.credentials.isProvisioned()) {
        request->send(400, "application/json", "{\"error\":\"Device not provisioned\"}");
        return;
    }
    if (deps.supabase.getAccessToken().isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"Device auth token not available\"}");
        return;
    }

    // Ensure we have a valid authentication token
    if (!deps.supabase.isAuthenticated()) {
        if (!deps.supabase.authenticate()) {
            ESP_LOGE(TAG, "Failed to authenticate with Supabase");
            request->send(502, "application/json", "{\"error\":\"Failed to authenticate\"}");
            return;
        }
    }

    // Request a nonce from the webex-oauth-start edge function
    // The Supabase client will automatically include JWT + HMAC headers
    String responseBody;
    int httpCode = deps.supabase.makeRequestWithRetry(
        "webex-oauth-start", "POST", "{}", responseBody
    );

    if (httpCode != 200) {
        ESP_LOGE(TAG, "Failed to get OAuth nonce, HTTP %d", httpCode);
        request->send(502, "application/json", "{\"error\":\"Failed to initiate OAuth\"}");
        return;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, responseBody);
    if (err || !doc["nonce"].is<const char*>()) {
        ESP_LOGE(TAG, "Invalid nonce response: %s", err.c_str());
        request->send(502, "application/json", "{\"error\":\"Invalid OAuth response\"}");
        return;
    }

    const char* nonce = doc["nonce"];
    
    // Build URL with only nonce and serial (no secrets)
    String auth_url = "https://display.5ls.us/webexauth";
    auth_url += "?nonce=" + urlEncode(String(nonce));
    auth_url += "&serial=" + urlEncode(serial);

    JsonDocument respDoc;
    respDoc["auth_url"] = auth_url;

    String response;
    serializeJson(respDoc, response);
    request->send(200, "application/json", response);
}

void WebServerManager::handleOAuthCallback(AsyncWebServerRequest* request) {
    if (!request->hasParam("code") || !request->hasParam("state")) {
        request->send(400, "text/html", "<html><body><h1>Error</h1><p>Missing authorization code or state.</p></body></html>");
        return;
    }

    String code = request->getParam("code")->value();
    String state = request->getParam("state")->value();

    if (last_oauth_state.isEmpty() || state != last_oauth_state) {
        request->send(400, "text/html", "<html><body><h1>Error</h1><p>Invalid OAuth state.</p></body></html>");
        return;
    }

    pending_oauth_code = code;
    pending_oauth_redirect_uri = last_oauth_redirect_uri.isEmpty()
        ? buildRedirectUri()
        : last_oauth_redirect_uri;

    String html = "<html><head>";
    html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
    html += "<style>body{font-family:sans-serif;text-align:center;padding:50px;}</style>";
    html += "</head><body>";
    html += "<h1>Authorization Successful!</h1>";
    html += "<p>You can close this window.</p>";
    html += "<p>The display will update shortly.</p>";
    html += "</body></html>";

    request->send(200, "text/html", html);

    ESP_LOGI(TAG, "OAuth callback received, code: %s", code.substring(0, 10).c_str());
}
