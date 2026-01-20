// Main JavaScript for LED Matrix Webex website

document.addEventListener('DOMContentLoaded', () => {
    console.log('LED Matrix Webex website loaded');
    const themeStorageKey = 'led_matrix_theme';
    const themeToggle = document.querySelector('.theme-toggle');

    const getPreferredTheme = () => {
        const storedTheme = localStorage.getItem(themeStorageKey);
        if (storedTheme === 'light' || storedTheme === 'dark') {
            return storedTheme;
        }

        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }

        return 'light';
    };

    const updateThemeToggle = (theme) => {
        if (!themeToggle) {
            return;
        }

        themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        themeToggle.textContent = theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
    };

    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        updateThemeToggle(theme);
    };

    applyTheme(getPreferredTheme());

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            localStorage.setItem(themeStorageKey, nextTheme);
            applyTheme(nextTheme);
        });
    }

    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (event) => {
            const storedTheme = localStorage.getItem(themeStorageKey);
            if (storedTheme) {
                return;
            }
            applyTheme(event.matches ? 'dark' : 'light');
        });
    }

    // Add smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
});
