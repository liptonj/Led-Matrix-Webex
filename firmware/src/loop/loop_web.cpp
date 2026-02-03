/**
 * @file loop_web.cpp
 * @brief Web server handler
 *
 * Handles web server requests and OAuth callbacks.
 */

#include "loop_handlers.h"

#ifndef NATIVE_BUILD

#include "web/web_server.h"
#include "webex/webex_client.h"
#include "debug/remote_logger.h"

// =============================================================================
// WEB SERVER HANDLER
// =============================================================================

bool handleWebServer(LoopContext& ctx) {
    // Process web server requests
    ctx.web_server->loop();

    // Check for pending reboot from web server
    if (ctx.web_server->checkPendingReboot()) {
        return true;  // Won't actually return, device will restart
    }

    // Complete OAuth flow if callback was received
    if (ctx.web_server->hasPendingOAuthCode()) {
        String code = ctx.web_server->consumePendingOAuthCode();
        String redirect_uri = ctx.web_server->getPendingOAuthRedirectUri();
        bool auth_ok = ctx.webex_client->handleOAuthCallback(code, redirect_uri);
        ctx.app_state->webex_authenticated = auth_ok;
        ctx.web_server->clearPendingOAuth();
        Serial.printf("[WEBEX] OAuth exchange %s\n", auth_ok ? "successful" : "failed");
        if (auth_ok) {
            RLOG_INFO("Webex", "OAuth authentication successful");
        } else {
            RLOG_ERROR("Webex", "OAuth authentication failed");
        }
    }

    return false;
}

#endif // !NATIVE_BUILD
