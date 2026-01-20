#include "matrix_display.h"

void MatrixDisplay::showWifiDisconnected() {
    if (!initialized) return;

    const String screen_key = "wifi_offline";
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();

        // Draw WiFi icon centered, disconnected (red)
        int icon_x = (MATRIX_WIDTH - 7) / 2;
        int icon_y = 6;
        drawWifiIcon(icon_x, icon_y, false);

        drawCenteredText(getTextLineY(2, 8), "WIFI OFFLINE", COLOR_YELLOW);
        drawCenteredText(getTextLineY(3, 8), "NO CONNECTION", COLOR_WHITE);
    }
}
