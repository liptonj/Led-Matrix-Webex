/**
 * @file ESP32-HUB75-MatrixPanel-I2S-DMA.h
 * @brief Mock LED Matrix Panel driver for native simulation
 * 
 * Simulates the HUB75 LED matrix panel by outputting to console.
 */

#ifndef ESP32_HUB75_MATRIXPANEL_I2S_DMA_H
#define ESP32_HUB75_MATRIXPANEL_I2S_DMA_H

#include "Arduino.h"
#include <vector>

// Configuration structure
struct HUB75_I2S_CFG {
    // Pin configuration struct
    struct i2s_pins {
        int8_t r1, g1, b1;
        int8_t r2, g2, b2;
        int8_t a, b, c, d, e;
        int8_t clk, lat, oe;
        
        i2s_pins() : r1(-1), g1(-1), b1(-1), r2(-1), g2(-1), b2(-1),
                     a(-1), b(-1), c(-1), d(-1), e(-1), clk(-1), lat(-1), oe(-1) {}
        
        i2s_pins(int8_t _r1, int8_t _g1, int8_t _b1, int8_t _r2, int8_t _g2, int8_t _b2,
                 int8_t _a, int8_t _b_, int8_t _c, int8_t _d, int8_t _e,
                 int8_t _clk, int8_t _lat, int8_t _oe)
            : r1(_r1), g1(_g1), b1(_b1), r2(_r2), g2(_g2), b2(_b2),
              a(_a), b(_b_), c(_c), d(_d), e(_e), clk(_clk), lat(_lat), oe(_oe) {}
    };
    
    // Driver types
    enum shift_driver {
        SHIFTREG = 0,
        FM6124,
        FM6126A,
        ICN2038S,
        MBI5124,
        SM5266P
    };
    
    // Clock speed
    enum clk_speed {
        HZ_8M = 8000000,
        HZ_10M = 10000000,
        HZ_15M = 15000000,
        HZ_20M = 20000000
    };
    
    uint16_t mx_width;
    uint16_t mx_height;
    uint16_t chain_length;
    i2s_pins gpio;
    shift_driver driver;
    clk_speed i2sspeed;
    bool clkphase;
    uint8_t latch_blanking;
    bool double_buff;
    uint16_t min_refresh_rate;
    
    HUB75_I2S_CFG(uint16_t w = 64, uint16_t h = 32, uint16_t chain = 1, i2s_pins pins = i2s_pins())
        : mx_width(w), mx_height(h), chain_length(chain), gpio(pins),
          driver(SHIFTREG), i2sspeed(HZ_10M), clkphase(false), 
          latch_blanking(1), double_buff(false), min_refresh_rate(60) {}
};

/**
 * @brief Mock Matrix Panel class with ASCII art display simulation
 */
class MatrixPanel_I2S_DMA {
public:
    MatrixPanel_I2S_DMA(const HUB75_I2S_CFG& config)
        : _width(config.mx_width * config.chain_length)
        , _height(config.mx_height)
        , _brightness(128)
        , _textColor(0xFFFF)
        , _textSize(1)
        , _cursorX(0)
        , _cursorY(0)
        , _initialized(false) {
        
        _framebuffer.resize(_width * _height, 0);
    }
    
    bool begin() {
        _initialized = true;
        printf("[Matrix] Initialized %dx%d LED matrix (simulation)\n", _width, _height);
        clearScreen();
        return true;
    }
    
    void setBrightness8(uint8_t b) {
        _brightness = b;
        printf("[Matrix] Brightness set to %d\n", b);
    }
    
    uint8_t getBrightness8() {
        return _brightness;
    }
    
    void clearScreen() {
        std::fill(_framebuffer.begin(), _framebuffer.end(), 0);
    }
    
    void fillScreen(uint16_t color) {
        std::fill(_framebuffer.begin(), _framebuffer.end(), color);
    }
    
    void drawPixel(int16_t x, int16_t y, uint16_t color) {
        if (x >= 0 && x < _width && y >= 0 && y < _height) {
            _framebuffer[y * _width + x] = color;
        }
    }
    
    uint16_t getPixel(int16_t x, int16_t y) {
        if (x >= 0 && x < _width && y >= 0 && y < _height) {
            return _framebuffer[y * _width + x];
        }
        return 0;
    }
    
    void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
        // Bresenham's line algorithm
        int16_t steep = abs(y1 - y0) > abs(x1 - x0);
        if (steep) {
            std::swap(x0, y0);
            std::swap(x1, y1);
        }
        if (x0 > x1) {
            std::swap(x0, x1);
            std::swap(y0, y1);
        }
        
        int16_t dx = x1 - x0;
        int16_t dy = abs(y1 - y0);
        int16_t err = dx / 2;
        int16_t ystep = (y0 < y1) ? 1 : -1;
        
        for (; x0 <= x1; x0++) {
            if (steep) {
                drawPixel(y0, x0, color);
            } else {
                drawPixel(x0, y0, color);
            }
            err -= dy;
            if (err < 0) {
                y0 += ystep;
                err += dx;
            }
        }
    }
    
    void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) {
        for (int16_t i = 0; i < w; i++) {
            drawPixel(x + i, y, color);
        }
    }
    
    void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) {
        for (int16_t i = 0; i < h; i++) {
            drawPixel(x, y + i, color);
        }
    }
    
    void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
        drawFastHLine(x, y, w, color);
        drawFastHLine(x, y + h - 1, w, color);
        drawFastVLine(x, y, h, color);
        drawFastVLine(x + w - 1, y, h, color);
    }
    
    void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
        for (int16_t j = 0; j < h; j++) {
            for (int16_t i = 0; i < w; i++) {
                drawPixel(x + i, y + j, color);
            }
        }
    }
    
    void drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
        int16_t f = 1 - r;
        int16_t ddF_x = 1;
        int16_t ddF_y = -2 * r;
        int16_t x = 0;
        int16_t y = r;
        
        drawPixel(x0, y0 + r, color);
        drawPixel(x0, y0 - r, color);
        drawPixel(x0 + r, y0, color);
        drawPixel(x0 - r, y0, color);
        
        while (x < y) {
            if (f >= 0) {
                y--;
                ddF_y += 2;
                f += ddF_y;
            }
            x++;
            ddF_x += 2;
            f += ddF_x;
            
            drawPixel(x0 + x, y0 + y, color);
            drawPixel(x0 - x, y0 + y, color);
            drawPixel(x0 + x, y0 - y, color);
            drawPixel(x0 - x, y0 - y, color);
            drawPixel(x0 + y, y0 + x, color);
            drawPixel(x0 - y, y0 + x, color);
            drawPixel(x0 + y, y0 - x, color);
            drawPixel(x0 - y, y0 - x, color);
        }
    }
    
    void fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
        drawFastVLine(x0, y0 - r, 2 * r + 1, color);
        int16_t f = 1 - r;
        int16_t ddF_x = 1;
        int16_t ddF_y = -2 * r;
        int16_t x = 0;
        int16_t y = r;
        
        while (x < y) {
            if (f >= 0) {
                y--;
                ddF_y += 2;
                f += ddF_y;
            }
            x++;
            ddF_x += 2;
            f += ddF_x;
            
            drawFastVLine(x0 + x, y0 - y, 2 * y + 1, color);
            drawFastVLine(x0 - x, y0 - y, 2 * y + 1, color);
            drawFastVLine(x0 + y, y0 - x, 2 * x + 1, color);
            drawFastVLine(x0 - y, y0 - x, 2 * x + 1, color);
        }
    }
    
    // Text rendering (simplified)
    void setTextColor(uint16_t color) {
        _textColor = color;
    }
    
    void setTextSize(uint8_t size) {
        _textSize = size;
    }
    
    void setCursor(int16_t x, int16_t y) {
        _cursorX = x;
        _cursorY = y;
    }
    
    size_t print(const char* str) {
        printf("[Matrix] Text at (%d,%d): \"%s\" [color=0x%04X]\n", 
               _cursorX, _cursorY, str, _textColor);
        return strlen(str);
    }
    
    size_t print(const String& str) {
        return print(str.c_str());
    }
    
    size_t print(int n) {
        char buf[16];
        snprintf(buf, sizeof(buf), "%d", n);
        return print(buf);
    }
    
    size_t print(float n, int digits = 2) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%.*f", digits, n);
        return print(buf);
    }
    
    size_t println(const char* str = "") {
        size_t n = print(str);
        _cursorY += 8 * _textSize;
        _cursorX = 0;
        return n + 1;
    }
    
    size_t println(const String& str) {
        return println(str.c_str());
    }
    
    // Color conversion helpers
    static uint16_t color565(uint8_t r, uint8_t g, uint8_t b) {
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    }
    
    static uint16_t color444(uint8_t r, uint8_t g, uint8_t b) {
        return ((r & 0xF0) << 4) | (g & 0xF0) | ((b & 0xF0) >> 4);
    }
    
    // Dimensions
    int16_t width() const { return _width; }
    int16_t height() const { return _height; }
    
    // Double buffering
    void flipDMABuffer() {}
    void showDMABuffer() {}
    
    // Debug: dump display as ASCII art
    void dumpToConsole() {
        printf("\n+");
        for (int x = 0; x < _width; x++) printf("-");
        printf("+\n");
        
        for (int y = 0; y < _height; y++) {
            printf("|");
            for (int x = 0; x < _width; x++) {
                uint16_t pixel = _framebuffer[y * _width + x];
                if (pixel == 0) {
                    printf(" ");
                } else {
                    // Map color to ASCII character
                    uint8_t r = (pixel >> 11) & 0x1F;
                    uint8_t g = (pixel >> 5) & 0x3F;
                    uint8_t b = pixel & 0x1F;
                    uint8_t brightness = (r + g/2 + b) / 3;
                    
                    if (brightness > 20) printf("#");
                    else if (brightness > 15) printf("*");
                    else if (brightness > 10) printf("+");
                    else if (brightness > 5) printf(".");
                    else printf(",");
                }
            }
            printf("|\n");
        }
        
        printf("+");
        for (int x = 0; x < _width; x++) printf("-");
        printf("+\n");
    }

private:
    int16_t _width;
    int16_t _height;
    uint8_t _brightness;
    uint16_t _textColor;
    uint8_t _textSize;
    int16_t _cursorX;
    int16_t _cursorY;
    bool _initialized;
    std::vector<uint16_t> _framebuffer;
};

#endif // ESP32_HUB75_MATRIXPANEL_I2S_DMA_H
