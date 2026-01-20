/**
 * @file bootstrap_display.cpp
 * @brief Minimal LED Matrix Display Implementation
 */

#include "bootstrap_display.h"

BootstrapDisplay::BootstrapDisplay()
    : dma_display(nullptr),
      initialized(false),
      mode(DisplayMode::NONE),
      needs_render(false),
      last_render_ms(0),
      current_ssid(""),
      current_ip(""),
      current_hostname(""),
      current_message(""),
      current_error(""),
      bootstrap_version(""),
      ota_progress(0) {
}

BootstrapDisplay::~BootstrapDisplay() {
    if (dma_display) {
        delete dma_display;
    }
}

bool BootstrapDisplay::begin() {
    Serial.println("[DISPLAY] Initializing LED matrix...");

    // Configure HUB75 pins based on board type
#if defined(ESP32_S3_BOARD)
    // Seengreat adapter pin configuration for ESP32-S3
    HUB75_I2S_CFG::i2s_pins _pins = {
        37, 6, 36,    // R1, G1, B1
        35, 5, 0,     // R2, G2, B2
        45, 1, 48, 2, 4,  // A, B, C, D, E
        38, 21, 47    // LAT, OE, CLK (struct order is lat, oe, clk)
    };
#else
    // ESP32 (standard) pin configuration
    HUB75_I2S_CFG::i2s_pins _pins = {
        25, 26, 27, 14, 12, 13,
        23, 19, 5, 17, 32,
        16, 4, 15
    };
#endif

    // Matrix configuration
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,
        PANEL_RES_Y,
        PANEL_CHAIN,
        _pins
    );

    // Configure for FM6126A driver (common in these panels)
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    // Reduce visible flicker: higher refresh + stable latch blanking
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M;
    mxconfig.min_refresh_rate = 120;
    mxconfig.latch_blanking = 1;
    mxconfig.clkphase = false;

    // Create display instance
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);

    if (!dma_display->begin()) {
        Serial.println("[DISPLAY] Failed to initialize matrix!");
        delete dma_display;
        dma_display = nullptr;
        return false;
    }

    dma_display->setBrightness8(255);
    dma_display->clearScreen();

    initialized = true;
    Serial.println("[DISPLAY] Matrix initialized successfully");
    return true;
}

void BootstrapDisplay::clear() {
    if (!initialized) return;
    dma_display->clearScreen();
}

void BootstrapDisplay::update() {
    if (!initialized) return;

    unsigned long now = millis();
    if (!needs_render && !shouldAnimate(now)) {
        return;
    }

    render(now);
    last_render_ms = now;
    needs_render = false;
}

void BootstrapDisplay::drawText(int x, int y, const String& text, uint16_t color) {
    if (!initialized) return;
    dma_display->setTextColor(color);
    dma_display->setTextSize(1);
    dma_display->setTextWrap(false);
    dma_display->setCursor(x, clampTextY(y));
    dma_display->print(text);
}

void BootstrapDisplay::drawCenteredText(int y, const String& text, uint16_t color) {
    if (!initialized) return;
    // Each character is ~6 pixels wide
    int width = textWidth(text);
    int x = (MATRIX_WIDTH - width) / 2;
    if (x < 0) x = 0;
    drawText(x, y, text, color);
}

void BootstrapDisplay::drawScrollingText(int y, const String& text, uint16_t color, int padding) {
    if (!initialized) return;

    int width = textWidth(text);
    int available_width = MATRIX_WIDTH - padding;
    if (width <= available_width) {
        drawText(padding, y, text, color);
        return;
    }

    int offset = scrollOffsetForText(text, millis(), padding);
    drawScrollingTextWithOffset(y, text, color, offset, padding);
}

void BootstrapDisplay::drawScrollingTextWithOffset(int y, const String& text, uint16_t color, int offset, int padding) {
    if (!initialized) return;

    int x = MATRIX_WIDTH - offset;
    drawText(x, y, text, color);
}

void BootstrapDisplay::drawLineText(int y, const String& text, uint16_t color, bool scroll_if_needed, bool center) {
    if (!initialized || text.isEmpty()) return;
    if (center) {
        drawCenteredText(y, text, color);
        return;
    }
    if (scroll_if_needed) {
        drawScrollingText(y, text, color, 0);
        return;
    }
    drawText(0, y, text, color);
}

void BootstrapDisplay::drawWifiIcon(int x, int y, uint16_t color) {
    if (!initialized) return;

    // Simple 5x5 WiFi icon
    dma_display->drawPixel(x + 2, y + 4, color);
    dma_display->drawPixel(x + 1, y + 3, color);
    dma_display->drawPixel(x + 3, y + 3, color);
    dma_display->drawPixel(x + 0, y + 2, color);
    dma_display->drawPixel(x + 4, y + 2, color);
    dma_display->drawPixel(x + 1, y + 1, color);
    dma_display->drawPixel(x + 3, y + 1, color);
}

void BootstrapDisplay::drawWifiOffIcon(int x, int y, uint16_t color) {
    if (!initialized) return;

    // WiFi icon outline + slash
    drawWifiIcon(x, y, color);
    dma_display->drawLine(x, y + 4, x + 4, y, color);
}

int BootstrapDisplay::textWidth(const String& text) const {
    return text.length() * 6;
}

int BootstrapDisplay::clampTextY(int y) const {
    const int max_y = MATRIX_HEIGHT - 8;
    return y > max_y ? max_y : y;
}

int BootstrapDisplay::scrollOffsetForText(const String& text, unsigned long now, int padding) const {
    int width = textWidth(text);
    int available_width = MATRIX_WIDTH - padding;
    if (width <= available_width) {
        return 0;
    }

    const int gap_pixels = 12;
    const unsigned long frame_interval_ms = 80;
    int total_width = width + MATRIX_WIDTH + gap_pixels;
    return static_cast<int>((now / frame_interval_ms) % total_width);
}

bool BootstrapDisplay::shouldAnimate(unsigned long now) const {
    const unsigned long frame_interval_ms = 80;
    if (now - last_render_ms < frame_interval_ms) {
        return false;
    }

    if (mode == DisplayMode::AP_MODE) {
        return textWidth("WiFi: " + current_ssid) > MATRIX_WIDTH ||
               textWidth("IP: " + current_ip) > MATRIX_WIDTH;
    }
    if (mode == DisplayMode::CONNECTED) {
        return textWidth("IP: " + current_ip) > MATRIX_WIDTH ||
               textWidth("mDNS: " + current_hostname + ".local") > MATRIX_WIDTH;
    }
    if (mode == DisplayMode::CONNECTING) {
        return textWidth(current_ssid) > MATRIX_WIDTH;
    }
    if (mode == DisplayMode::OTA_PROGRESS) {
        String status = String(ota_progress) + "% " + current_message;
        return textWidth(status) > MATRIX_WIDTH;
    }
    if (mode == DisplayMode::ERROR) {
        return textWidth(current_error) > MATRIX_WIDTH;
    }
    return false;
}

void BootstrapDisplay::render(unsigned long now) {
    if (!initialized) return;

    dma_display->clearScreen();
    switch (mode) {
        case DisplayMode::BOOTSTRAP:
            renderBootstrap();
            break;
        case DisplayMode::AP_MODE:
            renderAPMode(now);
            break;
        case DisplayMode::CONNECTING:
            renderConnecting(now);
            break;
        case DisplayMode::CONNECTED:
            renderConnected(now);
            break;
        case DisplayMode::OTA_PROGRESS:
            renderOTAProgress(now);
            break;
        case DisplayMode::ERROR:
            renderError(now);
            break;
        case DisplayMode::NONE:
        default:
            break;
    }
}

void BootstrapDisplay::renderBootstrap() {
    drawCenteredText(0, "5LS", COLOR_CYAN);
    drawCenteredText(10, "STATUS", COLOR_WHITE);
    drawCenteredText(20, "v" + bootstrap_version, COLOR_GRAY);
}

void BootstrapDisplay::renderAPMode(unsigned long now) {
    (void)now;
    drawWifiOffIcon(1, 1, COLOR_GRAY);
    drawText(8, 0, "SETUP MODE", COLOR_YELLOW);
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);

    drawLineText(10, "WiFi: " + current_ssid, COLOR_CYAN, true);
    drawLineText(20, "IP: " + current_ip, COLOR_GREEN, true);
}

void BootstrapDisplay::renderConnecting(unsigned long now) {
    (void)now;
    drawWifiOffIcon(1, 1, COLOR_YELLOW);
    drawText(8, 0, "CONNECTING", COLOR_YELLOW);
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    drawLineText(10, current_ssid, COLOR_WHITE, true);
    drawCenteredText(24, "Please wait", COLOR_GRAY);
}

void BootstrapDisplay::renderConnected(unsigned long now) {
    (void)now;
    drawWifiIcon(1, 1, COLOR_GREEN);
    drawText(8, 0, "BOOTSTRAP", COLOR_GREEN);
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);

    String ip_line = "IP: " + current_ip;
    String mdns_line = "HOST: " + current_hostname + ".local";
    int ip_offset = scrollOffsetForText(ip_line, millis(), 0);
    int mdns_offset = scrollOffsetForText(mdns_line, millis(), 0);
    int synced_offset = max(ip_offset, mdns_offset);

    if (synced_offset > 0) {
        drawScrollingTextWithOffset(10, ip_line, COLOR_CYAN, synced_offset, 0);
        drawScrollingTextWithOffset(20, mdns_line, COLOR_GREEN, synced_offset, 0);
    } else {
        drawLineText(10, ip_line, COLOR_CYAN, false);
        drawLineText(20, mdns_line, COLOR_GREEN, false);
    }
}

void BootstrapDisplay::renderOTAProgress(unsigned long now) {
    (void)now;
    drawCenteredText(0, "UPDATING", COLOR_ORANGE);
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    drawProgressBar(12, ota_progress, COLOR_CYAN);

    String status = String(ota_progress) + "% " + current_message;
    drawLineText(20, status, COLOR_WHITE, true);
}

void BootstrapDisplay::renderError(unsigned long now) {
    (void)now;
    drawCenteredText(0, "ERROR", COLOR_RED);
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);
    drawLineText(14, current_error, COLOR_WHITE, true, true);
}

void BootstrapDisplay::drawProgressBar(int y, int progress, uint16_t color) {
    if (!initialized) return;

    // Draw progress bar background
    int barWidth = MATRIX_WIDTH - 8;
    int barHeight = 6;
    int x = 4;

    // Background
    dma_display->drawRect(x, y, barWidth, barHeight, COLOR_GRAY);

    // Fill
    int fillWidth = (progress * (barWidth - 2)) / 100;
    if (fillWidth > 0) {
        dma_display->fillRect(x + 1, y + 1, fillWidth, barHeight - 2, color);
    }
}

void BootstrapDisplay::showBootstrap(const char* version) {
    if (!initialized) return;

    bootstrap_version = String(version);
    mode = DisplayMode::BOOTSTRAP;
    needs_render = true;
    update();
}

void BootstrapDisplay::showAPMode(const String& ssid, const String& ip) {
    if (!initialized) return;

    current_ssid = ssid;
    current_ip = ip;
    mode = DisplayMode::AP_MODE;
    needs_render = true;
    update();
}

void BootstrapDisplay::showConnecting(const String& ssid) {
    if (!initialized) return;

    current_ssid = ssid;
    mode = DisplayMode::CONNECTING;
    needs_render = true;
    update();
}

void BootstrapDisplay::showConnected(const String& ip, const String& hostname) {
    if (!initialized) return;

    current_ip = ip;
    current_hostname = hostname;
    mode = DisplayMode::CONNECTED;
    needs_render = true;
    update();
}

void BootstrapDisplay::showOTAProgress(int progress, const String& message) {
    if (!initialized) return;

    ota_progress = progress;
    current_message = message;
    mode = DisplayMode::OTA_PROGRESS;
    needs_render = true;
    update();
}

void BootstrapDisplay::showError(const String& error) {
    if (!initialized) return;

    current_error = error;
    mode = DisplayMode::ERROR;
    needs_render = true;
    update();
}

