/**
 * Reddit Viewer - Utility Functions
 *
 * Collection of pure utility functions used throughout the application.
 * These functions have no side effects and don't depend on application state.
 *
 * @module utils
 */

import CONFIG from './config.js';

/**
 * Escapes HTML special characters to prevent XSS
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML-safe string
 *
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert("xss")&lt;/script&gt;'
 */
export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Decodes HTML entities in a string
 * Used for Reddit API responses that contain encoded URLs
 *
 * @param {string} str - String with HTML entities
 * @returns {string} Decoded string
 *
 * @example
 * decodeHtmlEntities('https://example.com?a=1&amp;b=2')
 * // Returns: 'https://example.com?a=1&b=2'
 */
export function decodeHtmlEntities(str) {
    if (!str) return str;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
}

/**
 * Delays execution for a specified duration
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>} Promise that resolves after delay
 *
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a debounced version of a function
 *
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 *
 * @example
 * const debouncedSearch = debounce(search, 300);
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Creates a throttled version of a function
 *
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum milliseconds between calls
 * @returns {Function} Throttled function
 *
 * @example
 * const throttledScroll = throttle(handleScroll, 100);
 */
export function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => { inThrottle = false; }, limit);
        }
    };
}

/**
 * Clamps a number between min and max values
 *
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 *
 * @example
 * clamp(150, 0, 100) // Returns: 100
 * clamp(-10, 0, 100) // Returns: 0
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Generates a unique callback name for JSONP requests
 *
 * @returns {string} Unique callback name
 *
 * @example
 * generateCallbackName() // Returns: 'cb_1234567890_abc123def'
 */
export function generateCallbackName() {
    return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Checks if a URL matches any of the image patterns
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL is a direct image link
 */
export function isDirectImageUrl(url) {
    if (!url) return false;
    return CONFIG.mediaPatterns.DIRECT_IMAGE.test(url);
}

/**
 * Checks if a URL is from Reddit's image host
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if URL is from i.redd.it
 */
export function isRedditImageUrl(url) {
    if (!url) return false;
    return CONFIG.mediaPatterns.REDDIT_IMAGE.test(url);
}

/**
 * Parses a subreddit input string
 * Removes 'r/' prefix and trailing slashes
 *
 * @param {string} input - Raw subreddit input
 * @returns {string} Cleaned subreddit name
 *
 * @example
 * parseSubredditInput('r/pics/') // Returns: 'pics'
 * parseSubredditInput('  pics+earthporn  ') // Returns: 'pics+earthporn'
 */
export function parseSubredditInput(input) {
    if (!input) return '';
    return input.trim().replace(/^r\//, '').replace(/\/$/, '');
}

/**
 * Formats a slide count display string
 *
 * @param {number} current - Current index (0-based)
 * @param {number} total - Total slides
 * @returns {string} Formatted string like "1 / 100"
 */
export function formatSlideCount(current, total) {
    return `${current + 1} / ${total}`;
}

/**
 * Creates a Reddit permalink URL
 *
 * @param {string} permalink - Reddit permalink path
 * @returns {string} Full Reddit URL
 */
export function createRedditUrl(permalink) {
    return `https://reddit.com${permalink}`;
}

/**
 * Detects the source of an external media URL
 *
 * @param {string} url - URL to analyze
 * @returns {string|null} Source name or null if not recognized
 */
export function detectMediaSource(url) {
    if (!url) return null;

    if (url.includes('imgur.com') || url.includes('i.imgur.com')) {
        return 'imgur';
    }
    if (url.includes('gfycat.com')) {
        return 'gfycat';
    }
    if (url.includes(atob('cmVkZ2lmcy5jb20='))) {
        return 'external';
    }
    if (url.includes('giphy.com') || url.includes('i.giphy.com')) {
        return 'giphy';
    }
    if (url.includes('i.redd.it') || url.includes('reddit.com')) {
        return 'reddit';
    }

    return null;
}

/**
 * Checks if the browser supports fullscreen API
 *
 * @returns {boolean} True if fullscreen is supported
 */
export function isFullscreenSupported() {
    return !!(
        document.fullscreenEnabled ||
        document.webkitFullscreenEnabled
    );
}

/**
 * Checks if currently in fullscreen mode
 *
 * @returns {boolean} True if in fullscreen
 */
export function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/**
 * Checks if the device supports touch events
 *
 * @returns {boolean} True if touch is supported
 */
export function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Checks if the user prefers reduced motion
 *
 * @returns {boolean} True if reduced motion is preferred
 */
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Local storage helper with error handling
 */
export const storage = {
    /**
     * Get an item from localStorage
     *
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if not found
     * @returns {*} Parsed value or default
     */
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.warn('localStorage get error:', error);
            return defaultValue;
        }
    },

    /**
     * Set an item in localStorage
     *
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @returns {boolean} True if successful
     */
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.warn('localStorage set error:', error);
            return false;
        }
    },

    /**
     * Remove an item from localStorage
     *
     * @param {string} key - Storage key
     */
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('localStorage remove error:', error);
        }
    }
};

/**
 * Event controller for managing event listeners with cleanup support
 *
 * @returns {Object} Event controller with add, remove, and cleanup methods
 */
export function createEventController() {
    /** @type {Array<{element: Element, type: string, handler: Function, options: Object}>} */
    const handlers = [];

    return {
        /**
         * Add an event listener and track it for cleanup
         *
         * @param {Element|Document|Window} element - Element to attach listener to
         * @param {string} type - Event type
         * @param {Function} handler - Event handler
         * @param {Object} [options] - Event listener options
         */
        add(element, type, handler, options = {}) {
            element.addEventListener(type, handler, options);
            handlers.push({ element, type, handler, options });
        },

        /**
         * Remove a specific event listener
         *
         * @param {Element|Document|Window} element - Element to remove from
         * @param {string} type - Event type
         * @param {Function} handler - Event handler to remove
         */
        remove(element, type, handler) {
            const index = handlers.findIndex(
                h => h.element === element && h.type === type && h.handler === handler
            );
            if (index !== -1) {
                const { options } = handlers[index];
                element.removeEventListener(type, handler, options);
                handlers.splice(index, 1);
            }
        },

        /**
         * Remove all tracked event listeners
         */
        cleanup() {
            handlers.forEach(({ element, type, handler, options }) => {
                element.removeEventListener(type, handler, options);
            });
            handlers.length = 0;
        },

        /**
         * Get count of tracked handlers
         *
         * @returns {number} Number of tracked handlers
         */
        getCount() {
            return handlers.length;
        }
    };
}

/**
 * Creates a simple event emitter for custom events
 *
 * @returns {Object} Event emitter with on, off, and emit methods
 */
export function createEventEmitter() {
    const events = new Map();

    return {
        /**
         * Subscribe to an event
         *
         * @param {string} event - Event name
         * @param {Function} callback - Event handler
         * @returns {Function} Unsubscribe function
         */
        on(event, callback) {
            if (!events.has(event)) {
                events.set(event, new Set());
            }
            events.get(event).add(callback);
            return () => this.off(event, callback);
        },

        /**
         * Unsubscribe from an event
         *
         * @param {string} event - Event name
         * @param {Function} callback - Event handler to remove
         */
        off(event, callback) {
            if (events.has(event)) {
                events.get(event).delete(callback);
            }
        },

        /**
         * Emit an event with data
         *
         * @param {string} event - Event name
         * @param {*} data - Data to pass to handlers
         */
        emit(event, data) {
            if (events.has(event)) {
                events.get(event).forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`Event handler error for "${event}":`, error);
                    }
                });
            }
        },

        /**
         * Remove all listeners for an event or all events
         *
         * @param {string} [event] - Event name, or omit to clear all
         */
        clear(event) {
            if (event) {
                events.delete(event);
            } else {
                events.clear();
            }
        }
    };
}

// Make utilities available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.utils = {
        escapeHtml,
        decodeHtmlEntities,
        sleep,
        debounce,
        throttle,
        clamp,
        generateCallbackName,
        isDirectImageUrl,
        isRedditImageUrl,
        parseSubredditInput,
        formatSlideCount,
        createRedditUrl,
        detectMediaSource,
        isFullscreenSupported,
        isFullscreen,
        isTouchDevice,
        prefersReducedMotion,
        storage,
        createEventController,
        createEventEmitter
    };
}
