#include "matrix_display.h"

void MatrixDisplay::showUnconfigured(const String& ip_address, const String& hostname) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "unconfig:" + ip_text + "|" + hostname;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, getTextLineY(0, 8), "WEBEX", COLOR_CYAN);
        drawText(2, getTextLineY(1, 8), "DISPLAY", COLOR_WHITE);
    }
    drawScrollingText(getTextLineY(2, 8), ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, "unconfig_ip");
    if (!hostname.isEmpty()) {
        String host_display = hostname + ".local";
        drawScrollingText(getTextLineY(3, 8), host_display, COLOR_CYAN, MATRIX_WIDTH - 4, "unconfig_host");
    } else {
        fillRect(0, getTextLineY(3, 8), MATRIX_WIDTH, 8, COLOR_BLACK);
    }
}
