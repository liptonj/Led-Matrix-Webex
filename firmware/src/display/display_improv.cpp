#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showImprovProvisioning() {
    if (!initialized) return;

    StaticScreenBuilder builder(this, "improv_setup", last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();

        // Draw WiFi icon centered (blue - setup mode)
        int icon_x = (MATRIX_WIDTH - 7) / 2;
        int icon_y = 4;
        drawWifiIcon(icon_x, icon_y, true);

        builder.drawCentered(builder.getLineY(2), "WIFI SETUP", COLOR_CYAN);
    }
    
    // Scroll "VIA WEB SERIAL" as it's too long for static display
    drawScrollingText(builder.getLineY(3), "VIA WEB SERIAL", COLOR_WHITE, MATRIX_WIDTH - 4, builder.getScrollKey("msg"));
}
