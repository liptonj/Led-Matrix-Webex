/**
 * Minimal ESP32-S3 test - just serial and LED
 */
#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    delay(2000);
    
    Serial.println("\n\n===================");
    Serial.println("ESP32-S3 ALIVE!");
    Serial.println("===================\n");
    
    pinMode(2, OUTPUT); // Built-in LED on some boards
}

void loop() {
    Serial.println("Loop running...");
    digitalWrite(2, HIGH);
    delay(500);
    digitalWrite(2, LOW);
    delay(500);
}
