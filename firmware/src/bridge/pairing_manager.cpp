/**
 * @file pairing_manager.cpp
 * @brief Pairing Code Manager Implementation
 */

#include "pairing_manager.h"
#include <esp_random.h>

// NVS namespace and key
#define NVS_NAMESPACE "pairing"
#define NVS_KEY_CODE "code"

// Character set for pairing codes (excluding confusing chars)
static const char CHARSET[] = PAIRING_CODE_CHARSET;
static const size_t CHARSET_LEN = sizeof(CHARSET) - 1;  // Exclude null terminator

PairingManager::PairingManager() : pairing_code("") {
}

PairingManager::~PairingManager() {
    preferences.end();
}

void PairingManager::begin() {
    // Try to load existing code from NVS
    if (!loadCode()) {
        // No saved code, generate a new one
        generateCode(true);
        Serial.println("[PAIRING] Generated new pairing code");
    } else {
        Serial.printf("[PAIRING] Loaded pairing code: %s\n", pairing_code.c_str());
    }
}

String PairingManager::generateCode(bool save) {
    pairing_code = "";
    
    for (int i = 0; i < PAIRING_CODE_LENGTH; i++) {
        pairing_code += randomChar();
    }
    
    Serial.printf("[PAIRING] Generated code: %s\n", pairing_code.c_str());
    
    if (save) {
        saveCode();
    }
    
    return pairing_code;
}

bool PairingManager::setCode(const String& code, bool save) {
    String upperCode = code;
    upperCode.toUpperCase();
    
    if (!isValidCode(upperCode)) {
        Serial.printf("[PAIRING] Invalid code format: %s\n", code.c_str());
        return false;
    }
    
    pairing_code = upperCode;
    
    if (save) {
        saveCode();
    }
    
    Serial.printf("[PAIRING] Code set to: %s\n", pairing_code.c_str());
    return true;
}

void PairingManager::clearCode() {
    pairing_code = "";
    
    if (preferences.begin(NVS_NAMESPACE, false)) {
        preferences.remove(NVS_KEY_CODE);
        preferences.end();
    }
    
    Serial.println("[PAIRING] Code cleared");
}

void PairingManager::saveCode() {
    if (preferences.begin(NVS_NAMESPACE, false)) {
        preferences.putString(NVS_KEY_CODE, pairing_code);
        preferences.end();
        Serial.printf("[PAIRING] Code saved to NVS: %s\n", pairing_code.c_str());
    } else {
        Serial.println("[PAIRING] Failed to open NVS for writing");
    }
}

bool PairingManager::loadCode() {
    if (preferences.begin(NVS_NAMESPACE, true)) {
        String savedCode = preferences.getString(NVS_KEY_CODE, "");
        preferences.end();
        
        if (!savedCode.isEmpty() && isValidCode(savedCode)) {
            pairing_code = savedCode;
            return true;
        }
    }
    
    return false;
}

bool PairingManager::isValidCode(const String& code) {
    if (code.length() != PAIRING_CODE_LENGTH) {
        return false;
    }
    
    // Check all characters are in the valid charset
    for (size_t i = 0; i < code.length(); i++) {
        char c = code.charAt(i);
        bool valid = false;
        
        for (size_t j = 0; j < CHARSET_LEN; j++) {
            if (CHARSET[j] == c) {
                valid = true;
                break;
            }
        }
        
        if (!valid) {
            return false;
        }
    }
    
    return true;
}

char PairingManager::randomChar() {
    uint32_t rand = esp_random();
    return CHARSET[rand % CHARSET_LEN];
}
