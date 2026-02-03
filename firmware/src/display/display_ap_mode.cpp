#include "matrix_display.h"
#include "display_helpers.h"

// AP Mode SSID - must match the SSID in wifi_manager.cpp
#define AP_MODE_SSID "Webex-Display-Setup"

void MatrixDisplay::showAPMode(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    StaticScreenBuilder builder(this, "ap:" + ip_text, last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();
        drawText(2, builder.getLineY(0, 8, 2), "WIFI SETUP", COLOR_CYAN);
        drawSmallText(2, builder.getLineY(1, 8, 2), "Connect to WiFi:", COLOR_WHITE);
    }
    // Show the SSID as scrolling text (it's too long for static display)
    drawScrollingText(builder.getLineY(2, 8, 2), AP_MODE_SSID, COLOR_YELLOW, MATRIX_WIDTH - 4, builder.getScrollKey("ssid"));
    // Show the IP address
    drawScrollingText(builder.getLineY(3, 8, 2), ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, builder.getScrollKey("ip"));
}
