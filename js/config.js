/**
 * Reddit Viewer - Configuration
 *
 * Central configuration for all constants, thresholds, and settings.
 * Extracted from inline values to improve maintainability.
 *
 * @module config
 */

/**
 * Application configuration object
 * @constant {Object}
 */
const CONFIG = Object.freeze({
    /**
     * Proxy Configuration
     * Update PROXY_URL with your Cloudflare Worker URL after deployment
     */
    proxy: {
        /** Cloudflare Worker proxy URL */
        URL: 'https://delicate-tree-1777.eliasroebl.workers.dev',

        /** Proxy is enabled */
        ENABLED: true
    },

    /**
     * API Configuration
     */
    api: {
        /** Base URL for Reddit JSON API (old.reddit.com has better JSONP support) */
        BASE_URL: 'https://old.reddit.com',

        /** Number of posts to fetch per API request */
        POSTS_PER_PAGE: 100,

        /** Timeout for JSONP requests in milliseconds */
        REQUEST_TIMEOUT: 15000,

        /** Number of retry attempts for failed requests */
        RETRY_ATTEMPTS: 3,

        /** Base delay for exponential backoff in milliseconds */
        RETRY_BASE_DELAY: 1000
    },

    /**
     * Slideshow Configuration
     */
    slideshow: {
        /** Number of slides to preload ahead of current position */
        PRELOAD_COUNT: 5,

        /** Threshold to trigger loading more posts (slides remaining) */
        PRELOAD_THRESHOLD: 15,

        /** Default autoplay speed in milliseconds */
        DEFAULT_AUTOPLAY_SPEED: 3000,

        /** Available autoplay speed options in milliseconds */
        AUTOPLAY_SPEEDS: [2000, 3000, 5000, 8000, 10000]
    },

    /**
     * Zoom Configuration
     */
    zoom: {
        /** Default zoom scale multiplier */
        DEFAULT_SCALE: 2,

        /** Minimum zoom scale */
        MIN_SCALE: 1,

        /** Maximum zoom scale */
        MAX_SCALE: 4
    },

    /**
     * Touch & Gesture Configuration
     */
    gestures: {
        /** Minimum distance in pixels for swipe detection */
        SWIPE_THRESHOLD: 40,

        /** Maximum movement in pixels for tap detection */
        TAP_THRESHOLD: 10,

        /** Maximum time in milliseconds for tap detection */
        TAP_MAX_DURATION: 300,

        /** Maximum time between taps for double-tap detection */
        DOUBLE_TAP_DELAY: 300,

        /** Delay before processing single tap (to allow double-tap) */
        SINGLE_TAP_DELAY: 300
    },

    /**
     * UI Timing Configuration (in milliseconds)
     */
    timing: {
        /** Duration to show swipe feedback indicator */
        SWIPE_FEEDBACK_DURATION: 150,

        /** Duration to show zoom indicator */
        ZOOM_INDICATOR_DURATION: 800,

        /** Duration to show navigation hint on first load */
        NAV_HINT_DURATION: 2500
    },

    /**
     * LocalStorage Configuration
     */
    storage: {
        /** Key for storing user preferences */
        PREFERENCES_KEY: 'reddit-viewer-prefs',

        /** Key for storing view history */
        HISTORY_KEY: 'reddit-viewer-history',

        /** Maximum number of history entries to store */
        MAX_HISTORY_ENTRIES: 100
    },

    /**
     * Default State Values
     */
    defaults: {
        /** Default sort option */
        SORT: 'hot',

        /** Default time filter for 'top' sort */
        TIME: 'all',

        /** Whether to show NSFW content by default */
        SHOW_NSFW: false,

        /** Whether UI is visible by default */
        UI_VISIBLE: true
    },

    /**
     * Media Source Patterns
     * Regular expressions for detecting external media sources
     */
    mediaPatterns: {
        /** Pattern for direct image URLs */
        DIRECT_IMAGE: /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i,

        /** Pattern for i.redd.it URLs */
        REDDIT_IMAGE: /i\.redd\.it/,

        /** Pattern for Imgur URLs */
        IMGUR: /imgur\.com\/(\w+)(?:\.(jpg|jpeg|png|gif|gifv|mp4))?/i,

        /** Pattern for i.imgur.com direct links */
        IMGUR_DIRECT: /i\.imgur\.com\/(\w+)\.gifv/i,

        /** Pattern for Gfycat URLs */
        GFYCAT: /gfycat\.com\/(?:(?:gifs\/detail|ifr|watch)\/)?(\w+)/i,

        /** Pattern for external video provider URLs */
        EXTERNAL_VIDEO: new RegExp(atob('cmVkZ2lmcw==') + '\\.com\\/(?:watch|ifr)\\/(\\w+)', 'i'),

        /** Pattern for Giphy URLs */
        GIPHY: /giphy\.com\/(?:gifs|media)\/(?:.*-)?(\w+)/i
    },

    /**
     * External Media URL Templates
     */
    mediaUrls: {
        /** Template for Imgur images */
        IMGUR_IMAGE: (id) => `https://i.imgur.com/${id}.jpg`,

        /** Template for Imgur videos */
        IMGUR_VIDEO: (id) => `https://i.imgur.com/${id}.mp4`,

        /** Template for Gfycat videos */
        GFYCAT_VIDEO: (id) => `https://thumbs.gfycat.com/${id}-mobile.mp4`,

        /** Template for Giphy GIFs */
        GIPHY_GIF: (id) => `https://media.giphy.com/media/${id}/giphy.gif`
    },

    /**
     * Keyboard Shortcuts
     */
    shortcuts: {
        NAVIGATE_PREV: ['ArrowLeft', 'ArrowUp'],
        NAVIGATE_NEXT: ['ArrowRight', 'ArrowDown', ' '],
        TOGGLE_FULLSCREEN: ['f', 'F'],
        TOGGLE_ZOOM: ['z', 'Z'],
        TOGGLE_AUTOPLAY: ['p', 'P'],
        SHOW_UI: ['Escape']
    },

    /**
     * Element IDs for DOM queries
     */
    elements: {
        HEADER: 'header',
        SUBREDDIT_FORM: 'subredditForm',
        SUBREDDIT_INPUT: 'subredditInput',
        LOAD_BTN: 'loadBtn',
        FULLSCREEN_BTN: 'fullscreenBtn',
        TIME_SELECT: 'timeSelect',
        ERROR: 'error',
        COUNTER: 'counter',
        SLIDESHOW: 'slideshow',
        EMPTY_STATE: 'emptyState',
        BOTTOM_BAR: 'bottomBar',
        POST_TITLE: 'postTitle',
        POST_META: 'postMeta',
        GALLERY_DOTS: 'galleryDots',
        NAV_HINT: 'navHint',
        TOUCH_LEFT: 'touchLeft',
        TOUCH_CENTER: 'touchCenter',
        TOUCH_RIGHT: 'touchRight',
        SWIPE_FEEDBACK_LEFT: 'swipeFeedbackLeft',
        SWIPE_FEEDBACK_RIGHT: 'swipeFeedbackRight',
        NSFW_TOGGLE: 'nsfwToggle',
        AUTOPLAY_BTN: 'autoplayBtn',
        SPEED_SELECT: 'speedSelect',
        ZOOM_INDICATOR: 'zoomIndicator'
    }
});

// Make CONFIG available globally and as a module export
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}

export default CONFIG;
