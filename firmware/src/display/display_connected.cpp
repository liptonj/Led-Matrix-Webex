#include "matrix_display.h"

void MatrixDisplay::showConnected(const String& ip_address, const String& hostname) {
    if (!initialized) return;

    const String ip_text = normalizeIpText(ip_address);
    const String screen_key = "connected:" + ip_text + hostname;
    const bool screen_changed = (last_static_key != screen_key);
    last_static_key = screen_key;

    if (screen_changed) {
        dma_display->clearScreen();
        drawCenteredText(getTextLineY(0, 8, 0), "CONNECTED", COLOR_GREEN);
    }
    
    // Show IP address
    const int ip_y = getTextLineY(1, 8, 2);
    fillRect(0, ip_y, MATRIX_WIDTH, 8, COLOR_BLACK);
    drawScrollingText(ip_y, ip_text, COLOR_WHITE, MATRIX_WIDTH - 4, "conn_ip");
    
    // Show hostname if provided
    if (!hostname.isEmpty()) {
        const int host_y = getTextLineY(2, 8, 4);
        fillRect(0, host_y, MATRIX_WIDTH, 8, COLOR_BLACK);
        String host_display = hostname + ".local";
        drawScrollingText(host_y, host_display, COLOR_CYAN, MATRIX_WIDTH - 4, "conn_host");
    }
}
