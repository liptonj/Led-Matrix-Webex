/**
 * @file realtime_watchdog.h
 * @brief Realtime connection health monitoring and watchdog
 * 
 * Internal helper functions for watchdog monitoring.
 * Implementation in realtime_watchdog.cpp
 */

#ifndef REALTIME_WATCHDOG_H
#define REALTIME_WATCHDOG_H

#include <Arduino.h>

/**
 * @brief Check if reconnection is needed and attempt it
 * @param current_time Current millis()
 * @param lastInitAttempt Last initialization attempt time (reference to update)
 * @return true if reconnection was attempted
 */
bool checkReconnection(unsigned long current_time, unsigned long& lastInitAttempt);

/**
 * @brief Update watchdog timer based on connection state
 * @param current_time Current millis()
 * @param lastSubscribedTime Reference to last subscribed time (to update)
 * @param lastWatchdogLog Reference to last watchdog log time (to update)
 * @param watchdogInit Reference to watchdog initialization flag (to update)
 */
void updateWatchdogTimer(unsigned long current_time,
                        unsigned long& lastSubscribedTime,
                        unsigned long& lastWatchdogLog,
                        bool& watchdogInit);

#endif // REALTIME_WATCHDOG_H
