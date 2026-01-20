#include "matrix_display.h"

void MatrixDisplay::showUnconfigured(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "unconfig:" + ip_text;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, getTextLineY(0, 8, 2), "WEBEX", COLOR_CYAN);
        drawText(2, getTextLineY(1, 8, 2), "DISPLAY", COLOR_WHITE);
    }
    drawScrollingText(getTextLineY(2, 8, 2), ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, "unconfig");
}
