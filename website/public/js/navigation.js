/**
 * LED Matrix Webex Display - Navigation Module
 * 
 * Hamburger menu with slide-in behavior, keyboard accessibility,
 * and responsive desktop/mobile handling.
 */

(function() {
    'use strict';

    // Navigation state
    let navOpen = false;
    let navToggle = null;
    let mainNav = null;
    let navBackdrop = null;
    let focusableElements = [];
    let firstFocusable = null;
    let lastFocusable = null;
    let previousActiveElement = null;

    /**
     * Initialize navigation when DOM is ready
     */
    function init() {
        navToggle = document.querySelector('.nav-toggle');
        mainNav = document.querySelector('.main-nav');
        navBackdrop = document.querySelector('.nav-backdrop');

        if (!navToggle || !mainNav) {
            console.warn('Navigation elements not found');
            return;
        }

        // Set up event listeners
        navToggle.addEventListener('click', toggleNav);
        
        if (navBackdrop) {
            navBackdrop.addEventListener('click', closeNav);
        }

        // Keyboard handling
        document.addEventListener('keydown', handleKeydown);

        // Handle resize events for responsive behavior
        window.addEventListener('resize', handleResize);

        // Mark current page in nav
        markActivePage();

        // Update focusable elements list
        updateFocusableElements();
    }

    /**
     * Toggle navigation open/closed
     */
    function toggleNav() {
        if (navOpen) {
            closeNav();
        } else {
            openNav();
        }
    }

    /**
     * Open navigation
     */
    function openNav() {
        navOpen = true;
        previousActiveElement = document.activeElement;

        // Update ARIA
        navToggle.setAttribute('aria-expanded', 'true');
        mainNav.setAttribute('aria-hidden', 'false');

        // Add classes for animation
        mainNav.classList.add('open');
        if (navBackdrop) {
            navBackdrop.classList.add('active');
        }

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        // Focus first link after animation
        setTimeout(() => {
            if (firstFocusable) {
                firstFocusable.focus();
            }
        }, 100);

        // Announce to screen readers
        announceToScreenReader('Navigation menu opened');
    }

    /**
     * Close navigation
     */
    function closeNav() {
        navOpen = false;

        // Update ARIA
        navToggle.setAttribute('aria-expanded', 'false');
        mainNav.setAttribute('aria-hidden', 'true');

        // Remove classes
        mainNav.classList.remove('open');
        if (navBackdrop) {
            navBackdrop.classList.remove('active');
        }

        // Restore body scroll
        document.body.style.overflow = '';

        // Return focus to toggle button
        if (previousActiveElement) {
            previousActiveElement.focus();
        }

        // Announce to screen readers
        announceToScreenReader('Navigation menu closed');
    }

    /**
     * Handle keyboard events
     */
    function handleKeydown(event) {
        // Escape key closes nav
        if (event.key === 'Escape' && navOpen) {
            closeNav();
            return;
        }

        // Tab key trapping when nav is open
        if (event.key === 'Tab' && navOpen) {
            handleTabKey(event);
        }
    }

    /**
     * Handle Tab key for focus trapping
     */
    function handleTabKey(event) {
        updateFocusableElements();

        if (!firstFocusable || !lastFocusable) return;

        if (event.shiftKey) {
            // Shift + Tab
            if (document.activeElement === firstFocusable) {
                event.preventDefault();
                lastFocusable.focus();
            }
        } else {
            // Tab
            if (document.activeElement === lastFocusable) {
                event.preventDefault();
                firstFocusable.focus();
            }
        }
    }

    /**
     * Update list of focusable elements in nav
     */
    function updateFocusableElements() {
        if (!mainNav) return;

        const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        focusableElements = Array.from(mainNav.querySelectorAll(selector));
        
        firstFocusable = focusableElements[0];
        lastFocusable = focusableElements[focusableElements.length - 1];
    }

    /**
     * Handle window resize for responsive behavior
     */
    function handleResize() {
        // Close mobile nav when resizing to desktop
        if (window.innerWidth >= 1024 && navOpen) {
            closeNav();
        }
    }

    /**
     * Mark the current page link as active
     */
    function markActivePage() {
        if (!mainNav) return;

        const currentPath = window.location.pathname;
        const currentPage = currentPath.split('/').pop() || 'index.html';

        const links = mainNav.querySelectorAll('.nav-links a');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href === currentPage || 
                (currentPage === '' && href === 'index.html') ||
                (currentPage === 'index.html' && href === 'index.html')) {
                link.classList.add('active');
                link.setAttribute('aria-current', 'page');
            } else {
                link.classList.remove('active');
                link.removeAttribute('aria-current');
            }
        });
    }

    /**
     * Announce message to screen readers
     */
    function announceToScreenReader(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'sr-only';
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }

    /**
     * Create navigation HTML dynamically
     * Call this if nav isn't in the HTML
     */
    function createNavigation(containerId) {
        const container = document.getElementById(containerId) || document.body;
        
        const navHTML = `
            <button class="nav-toggle" aria-expanded="false" aria-controls="main-nav" aria-label="Toggle navigation menu">
                <span></span>
                <span></span>
                <span></span>
            </button>
            <div class="nav-backdrop"></div>
            <nav class="main-nav" id="main-nav" aria-label="Main navigation" aria-hidden="true">
                <div class="nav-header">
                    <img src="icon-512.png" alt="">
                    <span>LED Matrix Webex</span>
                </div>
                <div class="nav-links">
                    <a href="index.html">
                        <span class="nav-icon">🏠</span>
                        Home
                    </a>
                    <a href="install.html">
                        <span class="nav-icon">🔌</span>
                        Install
                    </a>
                    <a href="hardware.html">
                        <span class="nav-icon">📦</span>
                        Hardware
                    </a>
                    <a href="troubleshooting.html">
                        <span class="nav-icon">🔧</span>
                        Troubleshoot
                    </a>
                    <div class="nav-divider"></div>
                    <a href="versions.html">
                        <span class="nav-icon">⬇️</span>
                        Downloads
                    </a>
                    <a href="api-docs.html">
                        <span class="nav-icon">📚</span>
                        API Docs
                    </a>
                    <a href="embedded/index.html">
                        <span class="nav-icon">📱</span>
                        Embedded App
                    </a>
                    <div class="nav-divider"></div>
                    <a href="https://github.com/liptonj/Led-Matrix-Webex" target="_blank" rel="noopener">
                        <span class="nav-icon">💻</span>
                        GitHub
                        <span class="external-icon">↗</span>
                    </a>
                </div>
                <div class="nav-footer">
                    <p>v1.1.16 | MIT License</p>
                </div>
            </nav>
        `;

        // Insert at beginning of container
        container.insertAdjacentHTML('afterbegin', navHTML);

        // Re-initialize after creating
        init();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose functions for external use
    window.Navigation = {
        init: init,
        open: openNav,
        close: closeNav,
        toggle: toggleNav,
        create: createNavigation
    };
})();
