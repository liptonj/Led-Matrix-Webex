/**
 * @file module_manager.cpp
 * @brief Module Manager Implementation
 */

#include "module_manager.h"
#include "../debug/log_system.h"

static const char* TAG = "MODULES";

ModuleManager::ModuleManager()
    : enabled_modules(INSTALLED_MODULES) {
}

bool ModuleManager::begin() {
    loadPreferences();
    
    ESP_LOGI(TAG, "Module Manager initialized");
    ESP_LOGI(TAG, "Installed: 0x%02X, Enabled: 0x%02X", 
                  INSTALLED_MODULES, enabled_modules);
    
    // Log installed modules
    for (size_t i = 0; i < AVAILABLE_MODULES_COUNT; i++) {
        if (isInstalled(AVAILABLE_MODULES[i].id)) {
            ESP_LOGI(TAG, "- %s v%s (%s)",
                         AVAILABLE_MODULES[i].name,
                         AVAILABLE_MODULES[i].version,
                         isEnabled(AVAILABLE_MODULES[i].id) ? "enabled" : "disabled");
        }
    }
    
    return true;
}

bool ModuleManager::isInstalled(uint8_t module_id) const {
    return (INSTALLED_MODULES & module_id) != 0;
}

bool ModuleManager::isEnabled(uint8_t module_id) const {
    // Must be installed to be enabled
    if (!isInstalled(module_id)) {
        return false;
    }
    return (enabled_modules & module_id) != 0;
}

void ModuleManager::setEnabled(uint8_t module_id, bool enabled) {
    // Can only enable installed modules
    if (!isInstalled(module_id)) {
        return;
    }
    
    // Core module cannot be disabled
    if (module_id == MODULE_CORE) {
        return;
    }
    
    if (enabled) {
        enabled_modules |= module_id;
    } else {
        enabled_modules &= ~module_id;
    }
    
    savePreferences();
}

uint8_t ModuleManager::getInstalledModules() const {
    return INSTALLED_MODULES;
}

uint8_t ModuleManager::getEnabledModules() const {
    return enabled_modules;
}

const ModuleInfo* ModuleManager::getModuleInfo(uint8_t module_id) const {
    for (size_t i = 0; i < AVAILABLE_MODULES_COUNT; i++) {
        if (AVAILABLE_MODULES[i].id == module_id) {
            return &AVAILABLE_MODULES[i];
        }
    }
    return nullptr;
}

const FirmwareVariant* ModuleManager::getVariant(const char* name) const {
    for (size_t i = 0; i < FIRMWARE_VARIANTS_COUNT; i++) {
        if (strcmp(FIRMWARE_VARIANTS[i].name, name) == 0) {
            return &FIRMWARE_VARIANTS[i];
        }
    }
    return nullptr;
}

const FirmwareVariant* ModuleManager::getRecommendedVariant() const {
    // Find the smallest variant that includes all enabled modules
    const FirmwareVariant* best = nullptr;
    size_t bestSize = SIZE_MAX;
    
    for (size_t i = 0; i < FIRMWARE_VARIANTS_COUNT; i++) {
        const FirmwareVariant* v = &FIRMWARE_VARIANTS[i];
        
        // Check if this variant includes all enabled modules
        if ((v->modules & enabled_modules) == enabled_modules) {
            if (v->size_kb < bestSize) {
                best = v;
                bestSize = v->size_kb;
            }
        }
    }
    
    // Default to full if no match
    if (!best) {
        best = getVariant("full");
    }
    
    return best;
}

std::vector<const ModuleInfo*> ModuleManager::getAllModules() const {
    std::vector<const ModuleInfo*> modules;
    for (size_t i = 0; i < AVAILABLE_MODULES_COUNT; i++) {
        modules.push_back(&AVAILABLE_MODULES[i]);
    }
    return modules;
}

std::vector<const FirmwareVariant*> ModuleManager::getAllVariants() const {
    std::vector<const FirmwareVariant*> variants;
    for (size_t i = 0; i < FIRMWARE_VARIANTS_COUNT; i++) {
        variants.push_back(&FIRMWARE_VARIANTS[i]);
    }
    return variants;
}

size_t ModuleManager::calculateEnabledSize() const {
    size_t total = 0;
    for (size_t i = 0; i < AVAILABLE_MODULES_COUNT; i++) {
        if (isEnabled(AVAILABLE_MODULES[i].id)) {
            total += AVAILABLE_MODULES[i].size_kb;
        }
    }
    return total;
}

String ModuleManager::getCurrentVariant() const {
    // Check if current modules match a known variant
    for (size_t i = 0; i < FIRMWARE_VARIANTS_COUNT; i++) {
        if (FIRMWARE_VARIANTS[i].modules == INSTALLED_MODULES) {
            return String(FIRMWARE_VARIANTS[i].name);
        }
    }
    return "custom";
}

void ModuleManager::loadPreferences() {
    prefs.begin("modules", true);  // Read-only
    enabled_modules = prefs.getUChar("enabled", INSTALLED_MODULES);
    prefs.end();
    
    // Ensure only installed modules are enabled
    enabled_modules &= INSTALLED_MODULES;
}

void ModuleManager::savePreferences() {
    prefs.begin("modules", false);  // Read-write
    prefs.putUChar("enabled", enabled_modules);
    prefs.end();
}
