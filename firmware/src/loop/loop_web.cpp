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
#include "../debug/log_system.h"
#include "display/matrix_display.h"
#include "../core/dependencies.h"

static const char* TAG = "WEB_LOOP";

// =============================================================================
// WEB SERVER HANDLER
// =============================================================================

bool handleWebServer(LoopContext& ctx) {
    auto& deps = getDependencies();
    if (deps.display.isOTALocked() && !ctx.web_server->isOTAUploadInProgress()) {
        if (ctx.web_server->isRunning()) {
            ctx.web_server->stop();
        }
        return false;
    }
    if (!deps.display.isOTALocked() && !ctx.web_server->isRunning()) {
        ctx.web_server->begin(ctx.config_manager, ctx.app_state, nullptr, ctx.mdns_manager);
    }

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
        if (auth_ok) {
            ESP_LOGI(TAG, "OAuth authentication successful");
        } else {
            ESP_LOGE(TAG, "OAuth authentication failed");
        }
    }

    return false;
}

#endif // !NATIVE_BUILD
