/**
 * @file config_supabase.cpp
 * @brief Supabase Configuration Domain Implementation
 */

#include "config_manager.h"
#include "config_macros.h"
#include "../debug/log_system.h"

static const char* TAG = "CFG_SUPA";

// Supabase Configuration

String ConfigManager::getSupabaseUrl() const {
    String url;
    if (!cache_loaded) {
        url = loadString("supabase_url", "");
    } else {
        url = cached_supabase_url;
    }
    
    // Fall back to build-time default if not configured
    #ifdef DEFAULT_SUPABASE_URL
    if (url.isEmpty()) {
        return DEFAULT_SUPABASE_URL;
    }
    #endif
    
    return url;
}

void ConfigManager::setSupabaseUrl(const String& url) {
    saveString("supabase_url", url);
    cached_supabase_url = url;
    ESP_LOGI(TAG, "Supabase URL saved: %s", url.isEmpty() ? "(empty)" : url.c_str());
}

String ConfigManager::getSupabaseAnonKey() const {
    String key;
    if (!cache_loaded) {
        key = loadString("supabase_anon", "");
    } else {
        key = cached_supabase_anon_key;
    }
    
    // Fall back to build-time default if not configured
    #ifdef DEFAULT_SUPABASE_ANON_KEY
    if (key.isEmpty()) {
        return DEFAULT_SUPABASE_ANON_KEY;
    }
    #endif
    
    return key;
}

void ConfigManager::setSupabaseAnonKey(const String& key) {
    saveString("supabase_anon", key);
    cached_supabase_anon_key = key;
    ESP_LOGI(TAG, "Supabase anon key saved: %s", key.isEmpty() ? "(empty)" : "(set)");
}

// OTA Configuration

String ConfigManager::getOTAUrl() const {
    String url = loadString("ota_url", "");
    if (url.isEmpty()) {
        // If Supabase URL is configured, use Supabase Edge Function for manifest
        // This allows firmware to point directly to Supabase instead of using a proxy
        String supabaseUrl = getSupabaseUrl();
        if (!supabaseUrl.isEmpty()) {
            return supabaseUrl + "/functions/v1/get-manifest";
        }
        // Fall back to build-time default (may also be Supabase URL if set during build)
        #ifdef DEFAULT_OTA_URL
        return DEFAULT_OTA_URL;
        #endif
    }
    return url;
}

void ConfigManager::setOTAUrl(const String& url) {
    saveString("ota_url", url);
}

CONFIG_UNCACHED_BOOL_GETTER(AutoUpdate, "auto_update", false)
CONFIG_UNCACHED_BOOL_SETTER(AutoUpdate, "auto_update")

CONFIG_UNCACHED_STRING_GETTER(FailedOTAVersion, "fail_ota_ver", "")

void ConfigManager::setFailedOTAVersion(const String& version) {
    saveString("fail_ota_ver", version);
}

void ConfigManager::clearFailedOTAVersion() {
    saveString("fail_ota_ver", "");
}
