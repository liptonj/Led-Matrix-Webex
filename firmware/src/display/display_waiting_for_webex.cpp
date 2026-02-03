#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showWaitingForWebex(const String& hostname) {
    if (!initialized) return;

    const String screen_key = "waiting:" + hostname;
    StaticScreenBuilder builder(this, screen_key, last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();

        // Status indicator
        drawStatusIcon(MATRIX_WIDTH / 2 - 4, 0, "pending");

        // Message
        builder.drawCentered(builder.getLineY(1, 8, 2), "WAITING", COLOR_YELLOW);

        // Separator
        builder.drawSeparator(17, COLOR_GRAY);

        // Label
        builder.drawCentered(builder.getLineY(2, 8, 2), "Connect via:", COLOR_WHITE);
    }
    
    // Hostname scrolls if long
    String displayHost = hostname + ".local";
    drawScrollingText(builder.getLineY(3, 8, 2), displayHost, COLOR_CYAN, MATRIX_WIDTH - 4, builder.getScrollKey("host"));
}
