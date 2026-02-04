/**
 * Reddit Viewer - State Management
 *
 * Centralized state management with change notification support.
 * Provides a predictable way to manage and observe application state.
 *
 * @module state
 */

import CONFIG from './config.js';

/**
 * @typedef {Object} AppState
 * @property {Array<Slide>} slides - Array of slide objects
 * @property {number} currentIndex - Current slide index
 * @property {string} sort - Current sort option (hot, new, top)
 * @property {string} time - Time filter for top sort
 * @property {string} subreddit - Current subreddit name
 * @property {boolean} loading - Whether content is loading
 * @property {string|null} after - Pagination token for Reddit API
 * @property {boolean} uiVisible - Whether UI controls are visible
 * @property {boolean} firstLoad - Whether this is the first load
 * @property {boolean} showNSFW - Whether to show NSFW content
 * @property {boolean} autoplay - Whether autoplay is active
 * @property {number|null} autoplayInterval - Autoplay interval ID
 * @property {number} autoplaySpeed - Autoplay speed in milliseconds
 * @property {boolean} isZoomed - Whether image is zoomed
 * @property {number} zoomScale - Current zoom scale
 * @property {number} panX - Pan X offset
 * @property {number} panY - Pan Y offset
 * @property {boolean} isPanning - Whether user is panning
 * @property {number} panStartX - Pan start X coordinate
 * @property {number} panStartY - Pan start Y coordinate
 * @property {Set<string>} preloadedImages - Set of preloaded image URLs
 */

/**
 * @typedef {Object} Slide
 * @property {string} postId - Reddit post ID
 * @property {string} title - Post title
 * @property {string} permalink - Reddit permalink
 * @property {string} author - Post author
 * @property {string} subreddit - Subreddit name
 * @property {boolean} [isNSFW] - Whether post is NSFW
 * @property {string} source - Media source (reddit, imgur, gfycat, etc.)
 * @property {string} type - Media type (image, video, gif)
 * @property {string} url - Media URL
 * @property {boolean} [isGallery] - Whether part of a gallery
 * @property {number} [galleryIndex] - Index in gallery (1-based)
 * @property {number} [galleryTotal] - Total items in gallery
 */

/**
 * Initial application state
 * @type {AppState}
 */
const initialState = {
    // Content state
    slides: [],
    currentIndex: 0,
    subreddit: '',
    after: null,
    loading: false,

    // Sort & filter state
    sort: CONFIG.defaults.SORT,
    time: CONFIG.defaults.TIME,
    showNSFW: CONFIG.defaults.SHOW_NSFW,

    // UI state
    uiVisible: CONFIG.defaults.UI_VISIBLE,
    firstLoad: true,

    // Autoplay state
    autoplay: false,
    autoplayInterval: null,
    autoplaySpeed: CONFIG.slideshow.DEFAULT_AUTOPLAY_SPEED,

    // Zoom & pan state
    isZoomed: false,
    zoomScale: CONFIG.zoom.DEFAULT_SCALE,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,

    // Preload cache
    preloadedImages: new Set()
};

/**
 * Creates a state store with subscription support
 *
 * @param {AppState} initial - Initial state object
 * @returns {Object} Store object with getState, setState, subscribe methods
 */
function createStore(initial) {
    /** @type {AppState} */
    let state = { ...initial };

    /** @type {Set<Function>} */
    const listeners = new Set();

    return {
        /**
         * Get the current state
         * @returns {AppState} Current state object (shallow copy)
         */
        getState() {
            return { ...state };
        },

        /**
         * Get a specific state value
         * @param {string} key - State key to retrieve
         * @returns {*} Value at the specified key
         */
        get(key) {
            return state[key];
        },

        /**
         * Update state with new values
         * @param {Partial<AppState>} updates - Object with state updates
         */
        setState(updates) {
            const prevState = state;
            state = { ...state, ...updates };

            // Notify listeners with previous and current state
            listeners.forEach(fn => {
                try {
                    fn(state, prevState);
                } catch (error) {
                    console.error('State listener error:', error);
                }
            });
        },

        /**
         * Subscribe to state changes
         * @param {Function} listener - Callback function(newState, prevState)
         * @returns {Function} Unsubscribe function
         */
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /**
         * Reset state to initial values
         * @param {Array<string>} [keys] - Specific keys to reset, or all if omitted
         */
        reset(keys) {
            if (keys) {
                const updates = {};
                keys.forEach(key => {
                    if (key in initial) {
                        updates[key] = key === 'preloadedImages'
                            ? new Set()
                            : initial[key];
                    }
                });
                this.setState(updates);
            } else {
                state = { ...initial, preloadedImages: new Set() };
                listeners.forEach(fn => fn(state, initial));
            }
        },

        /**
         * Get the number of active listeners
         * @returns {number} Listener count
         */
        getListenerCount() {
            return listeners.size;
        }
    };
}

/**
 * Application state store instance
 * @type {Object}
 */
const store = createStore(initialState);

/**
 * Convenience methods for common state operations
 */
const stateHelpers = {
    /**
     * Check if there are slides loaded
     * @returns {boolean}
     */
    hasSlides() {
        return store.get('slides').length > 0;
    },

    /**
     * Get current slide data
     * @returns {Slide|undefined}
     */
    getCurrentSlide() {
        const slides = store.get('slides');
        const index = store.get('currentIndex');
        return slides[index];
    },

    /**
     * Check if at first slide
     * @returns {boolean}
     */
    isAtStart() {
        return store.get('currentIndex') === 0;
    },

    /**
     * Check if at last slide
     * @returns {boolean}
     */
    isAtEnd() {
        const slides = store.get('slides');
        const index = store.get('currentIndex');
        return index >= slides.length - 1;
    },

    /**
     * Check if should preload more posts from API
     * @returns {boolean}
     */
    shouldPreloadPosts() {
        const slides = store.get('slides');
        const index = store.get('currentIndex');
        const after = store.get('after');
        const loading = store.get('loading');

        return (
            slides.length - index < CONFIG.slideshow.PRELOAD_THRESHOLD &&
            after !== null &&
            !loading
        );
    },

    /**
     * Add new slides to the collection
     * @param {Array<Slide>} newSlides - Slides to add
     * @param {boolean} [append=true] - Whether to append or replace
     */
    addSlides(newSlides, append = true) {
        const currentSlides = store.get('slides');
        store.setState({
            slides: append ? [...currentSlides, ...newSlides] : newSlides
        });
    },

    /**
     * Reset zoom state
     */
    resetZoom() {
        store.setState({
            isZoomed: false,
            panX: 0,
            panY: 0,
            isPanning: false
        });
    },

    /**
     * Reset for new subreddit load
     */
    resetForNewLoad() {
        store.setState({
            slides: [],
            currentIndex: 0,
            after: null,
            loading: true
        });
        store.get('preloadedImages').clear();
    }
};

// Make store available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.store = store;
    window.stateHelpers = stateHelpers;
}

export { store, stateHelpers, initialState };
export default store;
