#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

// Matrix configuration - THESE ARE THE WORKING SETTINGS
#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define PANEL_CHAIN 1

// Pin definitions for ESP32-S3 with Seengreat adapter
#define R1_PIN 37
#define G1_PIN 6
#define B1_PIN 36
#define R2_PIN 35
#define G2_PIN 5
#define B2_PIN 0
#define A_PIN 45
#define B_PIN 1
#define C_PIN 48
#define D_PIN 2
#define E_PIN 4
#define LAT_PIN 38
#define OE_PIN 21
#define CLK_PIN 47

// Colors
#define COLOR_RED    dma_display->color565(255, 0, 0)
#define COLOR_GREEN  dma_display->color565(0, 255, 0)
#define COLOR_BLUE   dma_display->color565(0, 0, 255)
#define COLOR_WHITE  dma_display->color565(255, 255, 255)
#define COLOR_BLACK  dma_display->color565(0, 0, 0)
#define COLOR_YELLOW dma_display->color565(255, 255, 0)
#define COLOR_CYAN   dma_display->color565(0, 255, 255)
#define COLOR_ORANGE dma_display->color565(255, 165, 0)
#define COLOR_GRAY   dma_display->color565(128, 128, 128)

MatrixPanel_I2S_DMA *dma_display = nullptr;
uint8_t test_phase = 0;

void showTestPattern(uint8_t phase);

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n\n========================================");
    Serial.println("LED Matrix Display Test");
    Serial.println("========================================\n");
    
    // Configure matrix
    HUB75_I2S_CFG mxconfig(
        PANEL_RES_X,   // Width
        PANEL_RES_Y,   // Height
        PANEL_CHAIN    // Chain length
    );
    
    // Set pin configuration for ESP32-S3
    mxconfig.gpio.r1 = R1_PIN;
    mxconfig.gpio.g1 = G1_PIN;
    mxconfig.gpio.b1 = B1_PIN;
    mxconfig.gpio.r2 = R2_PIN;
    mxconfig.gpio.g2 = G2_PIN;
    mxconfig.gpio.b2 = B2_PIN;
    mxconfig.gpio.a = A_PIN;
    mxconfig.gpio.b = B_PIN;
    mxconfig.gpio.c = C_PIN;
    mxconfig.gpio.d = D_PIN;
    mxconfig.gpio.e = E_PIN;
    mxconfig.gpio.lat = LAT_PIN;
    mxconfig.gpio.oe = OE_PIN;
    mxconfig.gpio.clk = CLK_PIN;
    
    // Clock phase and latch blanking for stability
    mxconfig.clkphase = false;
    mxconfig.driver = HUB75_I2S_CFG::FM6126A;
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_20M;
    mxconfig.min_refresh_rate = 120;
    mxconfig.latch_blanking = 1;
    
    // Create display
    dma_display = new MatrixPanel_I2S_DMA(mxconfig);
    
    if (!dma_display->begin()) {
        Serial.println("ERROR: Matrix panel initialization failed!");
        while (1) {
            delay(1000);
        }
    }
    
    dma_display->clearScreen();
    dma_display->setBrightness8(255);
    
    Serial.println("Matrix initialized successfully!");
    Serial.println("Running test patterns...");
    Serial.println("========================================\n");
}

void loop() {
    showTestPattern(test_phase);
    
    Serial.printf("Test pattern %d/5\n", test_phase + 1);
    
    test_phase = (test_phase + 1) % 6;
    delay(2000);
}

void showTestPattern(uint8_t phase) {
    dma_display->clearScreen();
    
    switch (phase) {
        case 0: {
            // Solid Red
            dma_display->fillScreen(COLOR_RED);
            dma_display->setCursor(10, 12);
            dma_display->setTextColor(COLOR_WHITE);
            dma_display->print("RED");
            Serial.println("Pattern: Solid Red");
            break;
        }
        
        case 1: {
            // Solid Green
            dma_display->fillScreen(COLOR_GREEN);
            dma_display->setCursor(8, 12);
            dma_display->setTextColor(COLOR_BLACK);
            dma_display->print("GREEN");
            Serial.println("Pattern: Solid Green");
            break;
        }
        
        case 2: {
            // Solid Blue
            dma_display->fillScreen(COLOR_BLUE);
            dma_display->setCursor(8, 12);
            dma_display->setTextColor(COLOR_WHITE);
            dma_display->print("BLUE");
            Serial.println("Pattern: Solid Blue");
            break;
        }
        
        case 3: {
            // Solid White
            dma_display->fillScreen(COLOR_WHITE);
            dma_display->setCursor(8, 12);
            dma_display->setTextColor(COLOR_BLACK);
            dma_display->print("WHITE");
            Serial.println("Pattern: Solid White");
            break;
        }
        
        case 4: {
            // Color Bars
            int bar_width = PANEL_RES_X / 8;
            uint16_t colors[8] = {
                COLOR_RED, COLOR_GREEN, COLOR_BLUE, COLOR_CYAN,
                COLOR_YELLOW, COLOR_ORANGE, COLOR_WHITE, COLOR_GRAY
            };
            
            for (int i = 0; i < 8; i++) {
                dma_display->fillRect(i * bar_width, 0, bar_width, PANEL_RES_Y, colors[i]);
            }
            
            dma_display->setCursor(18, 24);
            dma_display->setTextColor(COLOR_BLACK);
            dma_display->print("BARS");
            Serial.println("Pattern: Color Bars");
            break;
        }
        
        case 5: {
            // Checkerboard Pattern
            for (int y = 0; y < PANEL_RES_Y; y += 2) {
                for (int x = 0; x < PANEL_RES_X; x += 2) {
                    dma_display->drawPixel(x, y, COLOR_WHITE);
                }
            }
            
            dma_display->setCursor(8, 24);
            dma_display->setTextColor(COLOR_CYAN);
            dma_display->print("PIXELS");
            Serial.println("Pattern: Checkerboard");
            break;
        }
        
        default:
            break;
    }
}
