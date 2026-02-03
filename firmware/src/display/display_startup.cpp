#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showStartupScreen(const char* version) {
    if (!initialized) return;

    const String screen_key = "startup:" + String(version);
    StaticScreenBuilder builder(this, screen_key, last_static_key);

    if (builder.hasChanged()) {
        builder.clearScreen();
        drawText(8, builder.getLineY(0, 10, 4), "WEBEX", COLOR_CYAN);
        drawText(4, builder.getLineY(1, 10, 4), "DISPLAY", COLOR_WHITE);

        char ver_str[16];
        snprintf(ver_str, sizeof(ver_str), "v%s", version);
        drawSmallText(16, builder.getLineY(2, 10, 4), ver_str, COLOR_GRAY);
    }
}
