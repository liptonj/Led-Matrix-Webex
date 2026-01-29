/**
 * @file pairing_manager.h
 * @brief Pairing Code Manager for Bridge Connection
 * 
 * Generates and manages 6-character pairing codes for secure
 * pairing between embedded app and display.
 */

#ifndef PAIRING_MANAGER_H
#define PAIRING_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>

// Pairing code configuration
#define PAIRING_CODE_LENGTH 6
#define PAIRING_CODE_CHARSET "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  // Excluding confusing chars: I, O, 0, 1

/**
 * @brief Pairing Code Manager Class
 */
class PairingManager {
public:
    PairingManager();
    ~PairingManager();
    
    /**
     * @brief Initialize the pairing manager
     * Loads saved pairing code from NVS or generates new one
     */
    void begin();
    
    /**
     * @brief Get current pairing code
     * @return Current 6-character pairing code
     */
    String getCode() const { return pairing_code; }
    
    /**
     * @brief Check if a pairing code exists
     * @return true if code is set
     */
    bool hasCode() const { return !pairing_code.isEmpty(); }
    
    /**
     * @brief Generate a new random pairing code
     * @param save If true, saves to NVS
     * @return The new pairing code
     */
    String generateCode(bool save = true);
    
    /**
     * @brief Set a specific pairing code
     * @param code The code to set (will be uppercased)
     * @param save If true, saves to NVS
     * @return true if valid and set
     */
    bool setCode(const String& code, bool save = true);
    
    /**
     * @brief Clear the pairing code
     */
    void clearCode();
    
    /**
     * @brief Save current code to NVS
     */
    void saveCode();
    
    /**
     * @brief Load code from NVS
     * @return true if code was loaded
     */
    bool loadCode();
    
    /**
     * @brief Validate a pairing code format
     * @param code Code to validate
     * @return true if valid format
     */
    static bool isValidCode(const String& code);

private:
    Preferences preferences;
    String pairing_code;
    
    /**
     * @brief Generate a random character from charset
     * @return Random character
     */
    char randomChar();
};

#endif // PAIRING_MANAGER_H
