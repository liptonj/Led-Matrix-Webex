/**
 * @file api_webex.cpp
 * @brief Webex OAuth API Handlers
 */

#include "web_server.h"
#include "../webex/oauth_handler.h"
#include <ArduinoJson.h>
#include <ctype.h>

namespace {
String urlEncode(const String& str) {
    String encoded = "";
    char c;
    char code0;
    char code1;

    for (unsigned int i = 0; i < str.length(); i++) {
        c = str.charAt(i);

        if (c == ' ') {
            encoded += "%20";
        } else if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded += c;
        } else {
            code1 = (c & 0xf) + '0';
            if ((c & 0xf) > 9) {
                code1 = (c & 0xf) - 10 + 'A';
            }
            c = (c >> 4) & 0xf;
            code0 = c + '0';
            if (c > 9) {
                code0 = c - 10 + 'A';
            }
            encoded += '%';
            encoded += code0;
            encoded += code1;
        }
    }

    return encoded;
}
}  // namespace

void WebServerManager::handleWebexAuth(AsyncWebServerRequest* request) {
    String client_id = config_manager->getWebexClientId();

    if (client_id.isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"Webex client ID not configured\"}");
        return;
    }

    // Build OAuth authorization URL
    String redirect_uri = buildRedirectUri();
    String state = String(random(100000, 999999));

    String auth_url = WEBEX_AUTH_URL;
    auth_url += "?client_id=" + urlEncode(client_id);
    auth_url += "&response_type=code";
    auth_url += "&redirect_uri=" + urlEncode(redirect_uri);
    auth_url += "&scope=" + urlEncode(String(WEBEX_SCOPE_PEOPLE) + " " + String(WEBEX_SCOPE_XAPI));
    auth_url += "&state=" + state;

    // Store state for verification
    last_oauth_state = state;
    last_oauth_redirect_uri = redirect_uri;

    JsonDocument doc;
    doc["auth_url"] = auth_url;
    doc["state"] = state;
    doc["redirect_uri"] = redirect_uri;

    String response;
    serializeJson(doc, response);
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

    Serial.printf("[WEB] OAuth callback received, code: %s\n", code.substring(0, 10).c_str());
}
