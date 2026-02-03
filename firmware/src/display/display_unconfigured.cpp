#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showUnconfigured(const String& ip_address, const String& hostname) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "unconfig:" + ip_text + "|" + hostname;
    StaticScreenBuilder builder(this, screen_key, last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();
        builder.drawLine(0, "WEBEX", COLOR_CYAN);
        builder.drawLine(1, "DISPLAY", COLOR_WHITE);
    }
    
    drawScrollingText(builder.getLineY(2), ip_text, COLOR_GREEN, MATRIX_WIDTH - 4, builder.getScrollKey("ip"));
    
    if (!hostname.isEmpty()) {
        String host_display = hostname + ".local";
        drawScrollingText(builder.getLineY(3), host_display, COLOR_CYAN, MATRIX_WIDTH - 4, builder.getScrollKey("host"));
    }
}
