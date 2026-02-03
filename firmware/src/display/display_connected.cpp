#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showConnected(const String& ip_address, const String& hostname) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "connected:" + ip_text + "|" + hostname;
    StaticScreenBuilder builder(this, screen_key, last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();
        builder.drawTitle("CONNECTED", COLOR_GREEN);
    }
    
    // Show IP address
    drawScrollingText(builder.getLineY(1, 8, 2), ip_text, COLOR_WHITE, MATRIX_WIDTH - 4, builder.getScrollKey("ip"));
    
    // Show hostname if provided
    if (!hostname.isEmpty()) {
        String host_display = hostname + ".local";
        drawScrollingText(builder.getLineY(2, 8, 4), host_display, COLOR_CYAN, MATRIX_WIDTH - 4, builder.getScrollKey("host"));
    }
}
