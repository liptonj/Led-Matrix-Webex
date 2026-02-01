/**
 * @file timer_utils.h
 * @brief Timer Utility Classes for Interval Checking
 * 
 * Provides safe and convenient timer utilities for:
 * - Interval checking (has X milliseconds elapsed?)
 * - Automatic millis() wraparound handling
 * - Reset and restart functionality
 * 
 * Usage:
 *   IntervalTimer timer(1000);  // 1 second interval
 *   
 *   if (timer.hasElapsed()) {
 *       // Do periodic task
 *       timer.reset();  // or restart() to set new interval
 *   }
 */

#ifndef TIMER_UTILS_H
#define TIMER_UTILS_H

#include <Arduino.h>

/**
 * @brief Interval timer for periodic task execution
 * 
 * Handles millis() wraparound correctly (every ~49.7 days).
 * Uses unsigned long arithmetic to ensure proper behavior across wraparound.
 */
class IntervalTimer {
public:
    /**
     * @brief Construct a timer with the specified interval
     * @param intervalMs Interval in milliseconds
     */
    explicit IntervalTimer(unsigned long intervalMs = 0)
        : _intervalMs(intervalMs), _lastMs(millis()) {}
    
    /**
     * @brief Check if the interval has elapsed
     * @return true if interval has elapsed since last reset
     */
    bool hasElapsed() const {
        return (millis() - _lastMs) >= _intervalMs;
    }
    
    /**
     * @brief Check if at least specified milliseconds have elapsed
     * @param ms Milliseconds to check
     * @return true if at least ms have elapsed since last reset
     */
    bool hasElapsed(unsigned long ms) const {
        return (millis() - _lastMs) >= ms;
    }
    
    /**
     * @brief Get elapsed time since last reset
     * @return Milliseconds elapsed (handles wraparound correctly)
     */
    unsigned long elapsed() const {
        return millis() - _lastMs;
    }
    
    /**
     * @brief Reset the timer to current time
     * 
     * Call this after handling the event to restart the interval.
     */
    void reset() {
        _lastMs = millis();
    }
    
    /**
     * @brief Reset and change the interval
     * @param newIntervalMs New interval in milliseconds
     */
    void restart(unsigned long newIntervalMs) {
        _intervalMs = newIntervalMs;
        _lastMs = millis();
    }
    
    /**
     * @brief Change interval without resetting timer
     * @param newIntervalMs New interval in milliseconds
     */
    void setInterval(unsigned long newIntervalMs) {
        _intervalMs = newIntervalMs;
    }
    
    /**
     * @brief Get current interval
     * @return Interval in milliseconds
     */
    unsigned long getInterval() const {
        return _intervalMs;
    }
    
    /**
     * @brief Get remaining time until next interval
     * @return Milliseconds remaining (0 if already elapsed)
     */
    unsigned long remaining() const {
        unsigned long elapsed = millis() - _lastMs;
        if (elapsed >= _intervalMs) {
            return 0;
        }
        return _intervalMs - elapsed;
    }

private:
    unsigned long _intervalMs;  ///< Interval duration in milliseconds
    unsigned long _lastMs;      ///< Last reset time (from millis())
};

/**
 * @brief Simple timeout tracker
 * 
 * Useful for implementing timeouts in blocking operations or state machines.
 * 
 * Usage:
 *   Timeout timeout(5000);  // 5 second timeout
 *   while (!done && !timeout.hasExpired()) {
 *       // Try operation
 *   }
 */
class Timeout {
public:
    /**
     * @brief Construct a timeout starting now
     * @param timeoutMs Timeout duration in milliseconds
     */
    explicit Timeout(unsigned long timeoutMs)
        : _startMs(millis()), _timeoutMs(timeoutMs) {}
    
    /**
     * @brief Check if timeout has expired
     * @return true if timeout duration has elapsed
     */
    bool hasExpired() const {
        return (millis() - _startMs) >= _timeoutMs;
    }
    
    /**
     * @brief Get elapsed time since start
     * @return Milliseconds elapsed
     */
    unsigned long elapsed() const {
        return millis() - _startMs;
    }
    
    /**
     * @brief Get remaining time until timeout
     * @return Milliseconds remaining (0 if expired)
     */
    unsigned long remaining() const {
        unsigned long elapsed = millis() - _startMs;
        if (elapsed >= _timeoutMs) {
            return 0;
        }
        return _timeoutMs - elapsed;
    }
    
    /**
     * @brief Reset timeout to start from now
     */
    void reset() {
        _startMs = millis();
    }

private:
    unsigned long _startMs;     ///< Start time (from millis())
    unsigned long _timeoutMs;   ///< Timeout duration in milliseconds
};

#endif // TIMER_UTILS_H
