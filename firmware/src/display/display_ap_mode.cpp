#include "matrix_display.h"

// AP Mode SSID - must match the SSID in wifi_manager.cpp
#define AP_MODE_SSID "Webex-Display-Setup"

void MatrixDisplay::showAPMode(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "ap:" + ip_text;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, getTextLineY(0, 8, 2), "WIFI SETUP", COLOR_CYAN);
        drawSmallText(2, getTextLineY(1, 8, 2), "Connect to WiFi:", COLOR_WHITE);
    }
    // Show the SSID as scrolling text (it's too long for static display)
    drawScrollingText(getTextLineY(2, 8, 2), AP_MODE_SSID, COLOR_YELLOW, MATRIX_WIDTH - 4, "ap_ssid");
    // Show the IP address
    drawScrollingText(getTextLineY(3, 8, 2), ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, "ap_ip");
}
