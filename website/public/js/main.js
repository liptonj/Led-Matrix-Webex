/**
 * LED Matrix Webex Display - Main JavaScript
 * 
 * Theme toggle, smooth scrolling, and utility functions
 */

(function() {
    'use strict';

    const STORAGE_KEY = 'led_matrix_theme';

    /**
     * Get the preferred theme
     * Priority: localStorage > system preference > dark (default)
     */
    function getPreferredTheme() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
            return stored;
        }

        // Check system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }

        // Default to dark (Webex theme)
        return 'dark';
    }

    /**
     * Apply theme to document
     */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        updateThemeToggle(theme);
    }

    /**
     * Update theme toggle button text/state
     */
    function updateThemeToggle(theme) {
        const toggles = document.querySelectorAll('.theme-toggle');
        toggles.forEach(toggle => {
            toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
            toggle.textContent = theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
        });
    }

    /**
     * Toggle between light and dark theme
     */
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, next);
        applyTheme(next);
    }

    /**
     * Initialize theme toggle buttons
     */
    function initThemeToggles() {
        const toggles = document.querySelectorAll('.theme-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', toggleTheme);
        });
    }

    /**
     * Listen for system theme changes
     */
    function initSystemThemeListener() {
        if (!window.matchMedia) return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e) => {
            // Only follow system if user hasn't set a preference
            if (!localStorage.getItem(STORAGE_KEY)) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    /**
     * Initialize smooth scrolling for anchor links
     */
    function initSmoothScrolling() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const targetId = this.getAttribute('href');
                if (targetId === '#') return;

                const target = document.querySelector(targetId);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });

                    // Update URL without scrolling
                    history.pushState(null, '', targetId);
                }
            });
        });
    }

    /**
     * Add loading states to buttons
     */
    function setButtonLoading(button, loading) {
        if (loading) {
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = 'Loading...';
            button.classList.add('loading');
        } else {
            button.disabled = false;
            button.textContent = button.dataset.originalText || button.textContent;
            button.classList.remove('loading');
        }
    }

    /**
     * Format bytes to human readable
     */
    function formatBytes(bytes, decimals = 1) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    }

    /**
     * Format uptime in seconds to human readable
     */
    function formatUptime(seconds) {
        if (!seconds) return '--';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    /**
     * Debounce function
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Check if Web Serial API is supported
     */
    function isWebSerialSupported() {
        return 'serial' in navigator;
    }

    /**
     * Show browser compatibility warning
     */
    function showBrowserWarning() {
        const warning = document.getElementById('browser-warning');
        if (warning && !isWebSerialSupported()) {
            warning.style.display = 'block';
        }
    }

    /**
     * Initialize on DOM ready
     */
    function init() {
        // Apply theme immediately
        applyTheme(getPreferredTheme());

        // Set up event listeners
        initThemeToggles();
        initSystemThemeListener();
        initSmoothScrolling();
        showBrowserWarning();

        console.log('LED Matrix Webex website initialized');
    }

    // Run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose utility functions globally
    window.LedMatrix = {
        toggleTheme: toggleTheme,
        setButtonLoading: setButtonLoading,
        formatBytes: formatBytes,
        formatUptime: formatUptime,
        debounce: debounce,
        isWebSerialSupported: isWebSerialSupported
    };
})();
