#include "matrix_display.h"

void MatrixDisplay::showConnecting(const String& ssid) {
    if (!initialized) return;

    const String screen_key = "connecting:" + ssid;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawText(2, getTextLineY(0, 8, 2), "CONNECTING", COLOR_YELLOW);
    }

    drawScrollingText(getTextLineY(2, 8, 2), ssid, COLOR_WHITE, MATRIX_WIDTH - 4, "connecting");
}
