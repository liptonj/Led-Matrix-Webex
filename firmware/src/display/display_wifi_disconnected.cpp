#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showWifiDisconnected() {
    if (!initialized) return;

    StaticScreenBuilder builder(this, "wifi_offline", last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();

        // Draw WiFi icon centered, disconnected (red)
        int icon_x = (MATRIX_WIDTH - 7) / 2;
        int icon_y = 6;
        drawWifiIcon(icon_x, icon_y, false);

        drawCenteredText(builder.getLineY(2, 8), "WIFI OFFLINE", COLOR_YELLOW);
        drawCenteredText(builder.getLineY(3, 8), "NO CONNECTION", COLOR_WHITE);
    }
}
