#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showSetupHostname(const String& hostname) {
    if (!initialized) return;

    const String screen_key = "setup:" + hostname;
    StaticScreenBuilder builder(this, screen_key, last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();

        // Title
        builder.drawCentered(builder.getLineY(0, 9), "SETUP", COLOR_CYAN);

        // Separator
        builder.drawSeparator(8, COLOR_GRAY);

        // Instructions
        builder.drawCentered(builder.getLineY(1, 9), "Open in Webex:", COLOR_WHITE);

        // Separator
        builder.drawSeparator(25, COLOR_GRAY);

        // Embedded app path hint
        builder.drawCentered(builder.getLineY(3, 9), "/embedded", COLOR_YELLOW);
    }
    
    // Hostname scrolls if long
    String displayHost = hostname + ".local";
    drawScrollingText(builder.getLineY(2, 9), displayHost, COLOR_GREEN, MATRIX_WIDTH - 4, builder.getScrollKey("host"));
}
