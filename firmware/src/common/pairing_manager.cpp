/**
 * @file pairing_manager.cpp
 * @brief Pairing Code Manager Implementation
 */

#include "pairing_manager.h"
#include "nvs_utils.h"
#include <esp_random.h>

// Character set for pairing codes (excluding confusing chars)
static const char CHARSET[] = PAIRING_CODE_CHARSET;
static const size_t CHARSET_LEN = sizeof(CHARSET) - 1;  // Exclude null terminator

PairingManager::PairingManager() : pairing_code("") {
}

void PairingManager::begin() {
    // Try to load existing code from NVS
    if (!loadCode()) {
        // No saved code, generate a new one
        generateCode(true);
        Serial.println("[PAIRING] Generated new pairing code");
    } else {
        Serial.println("[PAIRING] Loaded existing pairing code from NVS");
    }
}

String PairingManager::generateCode(bool save) {
    pairing_code = "";
    
    for (int i = 0; i < PAIRING_CODE_LENGTH; i++) {
        pairing_code += randomChar();
    }
    
    Serial.println("[PAIRING] Generated new pairing code");
    
    if (save) {
        saveCode();
    }
    
    return pairing_code;
}

bool PairingManager::setCode(const String& code, bool save) {
    String upperCode = code;
    upperCode.toUpperCase();
    
    if (!isValidCode(upperCode)) {
        Serial.println("[PAIRING] Invalid code format");
        return false;
    }
    
    pairing_code = upperCode;
    
    if (save) {
        saveCode();
    }
    
    Serial.println("[PAIRING] Code updated");
    return true;
}

void PairingManager::clearCode() {
    pairing_code = "";
    
    NvsScope nvs(PAIRING_NVS_NAMESPACE);
    if (nvs.isOpen()) {
        nvs.remove(PAIRING_NVS_KEY_CODE);
    }
    
    Serial.println("[PAIRING] Code cleared");
}

void PairingManager::saveCode() {
    NvsScope nvs(PAIRING_NVS_NAMESPACE);
    if (nvs.isOpen()) {
        NvsResult result = nvs.putString(PAIRING_NVS_KEY_CODE, pairing_code);
        if (result == NvsResult::OK) {
            Serial.println("[PAIRING] Code saved to NVS");
        } else {
            Serial.printf("[PAIRING] Failed to save code: %s\n", nvsResultToString(result));
        }
    } else {
        Serial.println("[PAIRING] Failed to open NVS for writing");
    }
}

bool PairingManager::loadCode() {
    NvsScope nvs(PAIRING_NVS_NAMESPACE, true);  // Read-only
    if (nvs.isOpen()) {
        String savedCode = nvs.getString(PAIRING_NVS_KEY_CODE, "");
        
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
