#include "matrix_display.h"

void MatrixDisplay::showConnected(const String& ip_address) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "connected:" + ip_text;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        // Center "CONNECTED" text
        drawCenteredText(getTextLineY(0, 8, 2), "CONNECTED", COLOR_GREEN);
    }
    // Always clear and redraw IP line to prevent flicker
    const int ip_y = getTextLineY(2, 8, 2);
    fillRect(0, ip_y, MATRIX_WIDTH, 8, COLOR_BLACK);
    drawScrollingText(ip_y, ip_text, COLOR_WHITE, MATRIX_WIDTH - 4, "connected");
}
