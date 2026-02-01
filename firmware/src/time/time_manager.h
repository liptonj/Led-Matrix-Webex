#ifndef TIME_MANAGER_H
#define TIME_MANAGER_H

#include <Arduino.h>
#include "../config/config_manager.h"
#include "../app_state.h"

bool applyTimeConfig(const ConfigManager& config, AppState* state);
bool syncTime(AppState* state);

#endif // TIME_MANAGER_H
