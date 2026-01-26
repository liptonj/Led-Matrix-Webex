#include "matrix_display.h"

void MatrixDisplay::showImprovProvisioning() {
    if (!initialized) return;

    const String screen_key = "improv_setup";
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();

        // Draw WiFi icon centered (blue - setup mode)
        int icon_x = (MATRIX_WIDTH - 7) / 2;
        int icon_y = 4;
        drawWifiIcon(icon_x, icon_y, true);

        drawCenteredText(getTextLineY(2, 8), "WIFI SETUP", COLOR_CYAN);
    }
    
    // Scroll "VIA WEB SERIAL" as it's too long for static display
    drawScrollingText(getTextLineY(3, 8), "VIA WEB SERIAL", COLOR_WHITE, MATRIX_WIDTH - 4, "improv_msg");
}
