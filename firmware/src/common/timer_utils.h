/**
 * @file timer_utils.h
 * @brief Timer Utility Classes for Interval Checking
 * 
 * Provides safe and convenient timer utilities for:
 * - Interval checking (has X milliseconds elapsed?)
 * - Automatic millis() wraparound handling
 * - Reset and restart functionality
 * - Exponential backoff for retry logic
 * - One-shot timers for delayed actions
 * 
 * Usage:
 *   IntervalTimer timer(1000);  // 1 second interval
 *   
 *   if (timer.check()) {
 *       // Do periodic task (automatically resets)
 *   }
 */

#ifndef TIMER_UTILS_H
#define TIMER_UTILS_H

#include <Arduino.h>

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

/**
 * @brief Simple interval timer for periodic checks
 * 
 * Provides a simple API with automatic reset on check().
 * Handles millis() wraparound correctly (every ~49.7 days).
 * 
 * Usage:
 *   IntervalTimer timer(1000);  // 1 second interval
 *   
 *   if (timer.check()) {
 *       // Do periodic task (automatically resets)
 *   }
 *   
 *   // Peek without resetting
 *   if (timer.isReady()) {
 *       // Will trigger soon, but don't reset yet
 *   }
 */
class IntervalTimer {
public:
    /**
     * @brief Construct a timer with the specified interval
     * @param intervalMs Interval in milliseconds (0 = disabled)
     */
    IntervalTimer(unsigned long intervalMs = 0) 
        : _interval(intervalMs), _lastTrigger(0), _enabled(true) {}
    
    /**
     * @brief Set interval in milliseconds
     * @param intervalMs New interval in milliseconds
     */
    void setInterval(unsigned long intervalMs) { _interval = intervalMs; }
    
    /**
     * @brief Check if interval has elapsed (and reset if true)
     * @return true if interval has elapsed since last trigger
     * 
     * Automatically resets the timer when interval elapses.
     */
    bool check() {
        if (!_enabled || _interval == 0) return false;
        unsigned long now = millis();
        if (now - _lastTrigger >= _interval) {
            _lastTrigger = now;
            return true;
        }
        return false;
    }
    
    /**
     * @brief Check without resetting (peek)
     * @return true if interval has elapsed, false otherwise
     * 
     * Does not reset the timer, useful for checking if ready without triggering.
     */
    bool isReady() const {
        if (!_enabled || _interval == 0) return false;
        return (millis() - _lastTrigger) >= _interval;
    }
    
    /**
     * @brief Force trigger on next check
     * 
     * Resets the timer so the next check() will return true.
     */
    void reset() { _lastTrigger = 0; }
    
    /**
     * @brief Reset to current time (delay next trigger)
     * 
     * Resets the timer to now, delaying the next trigger by the full interval.
     */
    void touch() { _lastTrigger = millis(); }
    
    /**
     * @brief Enable the timer
     */
    void enable() { _enabled = true; }
    
    /**
     * @brief Disable the timer
     */
    void disable() { _enabled = false; }
    
    /**
     * @brief Check if timer is enabled
     * @return true if enabled, false otherwise
     */
    bool isEnabled() const { return _enabled; }
    
    /**
     * @brief Get time since last trigger
     * @return Milliseconds elapsed since last trigger
     */
    unsigned long elapsed() const { return millis() - _lastTrigger; }
    
    /**
     * @brief Get remaining time until next trigger
     * @return Milliseconds remaining (0 if already elapsed)
     */
    unsigned long remaining() const {
        unsigned long elapsed = millis() - _lastTrigger;
        return (elapsed >= _interval) ? 0 : (_interval - elapsed);
    }

private:
    unsigned long _interval;      ///< Interval duration in milliseconds
    unsigned long _lastTrigger;    ///< Last trigger time (from millis())
    bool _enabled;                 ///< Whether timer is enabled
};

/**
 * @brief Exponential backoff for retry logic
 * 
 * Automatically increases delay between retry attempts using exponential backoff.
 * Useful for network operations, reconnection logic, etc.
 * 
 * Usage:
 *   ExponentialBackoff backoff(1000, 60000);  // Start at 1s, max 60s
 *   
 *   if (backoff.isReady()) {
 *       if (attemptOperation()) {
 *           backoff.recordSuccess();  // Reset on success
 *       } else {
 *           backoff.recordFailure();  // Increase delay
 *       }
 *   }
 */
class ExponentialBackoff {
public:
    /**
     * @brief Construct an exponential backoff timer
     * @param minDelayMs Minimum delay in milliseconds
     * @param maxDelayMs Maximum delay in milliseconds
     * @param multiplier Multiplier for each failure (default 2.0)
     */
    ExponentialBackoff(unsigned long minDelayMs, unsigned long maxDelayMs, float multiplier = 2.0f)
        : _minDelay(minDelayMs), _maxDelay(maxDelayMs), _multiplier(multiplier),
          _currentDelay(minDelayMs), _lastAttempt(0), _attempts(0) {}
    
    /**
     * @brief Check if ready for next attempt
     * @return true if enough time has passed since last failure
     */
    bool isReady() const {
        return (millis() - _lastAttempt) >= _currentDelay;
    }
    
    /**
     * @brief Record a failed attempt (increases delay)
     * 
     * Call this after a failed operation to increase the delay for next retry.
     */
    void recordFailure() {
        _lastAttempt = millis();
        _attempts++;
        _currentDelay = min((unsigned long)(_currentDelay * _multiplier), _maxDelay);
    }
    
    /**
     * @brief Record success (resets delay)
     * 
     * Call this after a successful operation to reset the delay to minimum.
     */
    void recordSuccess() {
        reset();
    }
    
    /**
     * @brief Reset to initial state
     * 
     * Resets delay to minimum and clears attempt count.
     */
    void reset() {
        _currentDelay = _minDelay;
        _attempts = 0;
        _lastAttempt = 0;
    }
    
    /**
     * @brief Get current delay
     * @return Current delay in milliseconds
     */
    unsigned long getCurrentDelay() const { return _currentDelay; }
    
    /**
     * @brief Get attempt count
     * @return Number of attempts since last reset
     */
    unsigned int getAttempts() const { return _attempts; }
    
    /**
     * @brief Get time until next retry is allowed
     * @return Milliseconds remaining until ready (0 if ready now)
     */
    unsigned long getTimeUntilReady() const {
        unsigned long elapsed = millis() - _lastAttempt;
        return (elapsed >= _currentDelay) ? 0 : (_currentDelay - elapsed);
    }

private:
    unsigned long _minDelay;      ///< Minimum delay in milliseconds
    unsigned long _maxDelay;       ///< Maximum delay in milliseconds
    float _multiplier;             ///< Multiplier for exponential backoff
    unsigned long _currentDelay;   ///< Current delay in milliseconds
    unsigned long _lastAttempt;    ///< Last attempt time (from millis())
    unsigned int _attempts;        ///< Number of attempts since last reset
};

/**
 * @brief One-shot timer (triggers once after delay)
 * 
 * Useful for delayed actions, timeouts, or single-use timers.
 * 
 * Usage:
 *   OneShotTimer timer;
 *   timer.arm(5000);  // Trigger after 5 seconds
 *   
 *   if (timer.check()) {
 *       // Timer triggered (auto-disarms)
 *   }
 */
class OneShotTimer {
public:
    /**
     * @brief Construct a one-shot timer
     */
    OneShotTimer() : _targetTime(0), _armed(false) {}
    
    /**
     * @brief Arm the timer to trigger after delayMs
     * @param delayMs Delay in milliseconds before trigger
     */
    void arm(unsigned long delayMs) {
        _targetTime = millis() + delayMs;
        _armed = true;
    }
    
    /**
     * @brief Check if timer has triggered (auto-disarms)
     * @return true if timer has triggered, false otherwise
     * 
     * Automatically disarms the timer when triggered.
     */
    bool check() {
        if (!_armed) return false;
        if (millis() >= _targetTime) {
            _armed = false;
            return true;
        }
        return false;
    }
    
    /**
     * @brief Check without disarming
     * @return true if timer has triggered, false otherwise
     * 
     * Does not disarm the timer, useful for checking status.
     */
    bool isTriggered() const {
        return _armed && (millis() >= _targetTime);
    }
    
    /**
     * @brief Disarm the timer
     * 
     * Prevents the timer from triggering.
     */
    void disarm() { _armed = false; }
    
    /**
     * @brief Check if timer is armed
     * @return true if armed, false otherwise
     */
    bool isArmed() const { return _armed; }

private:
    unsigned long _targetTime;     ///< Target time when timer should trigger
    bool _armed;                   ///< Whether timer is armed
};

#endif // TIMER_UTILS_H
