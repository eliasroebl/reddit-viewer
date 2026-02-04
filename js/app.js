/**
 * Reddit Viewer - Main Application
 *
 * Entry point and orchestration for the Reddit media viewer.
 * Initializes all modules and coordinates application flow.
 *
 * @module app
 */

import CONFIG from './config.js';
import { store, stateHelpers } from './state.js';
import { storage, parseSubredditInput } from './utils.js';
import { fetchPosts } from './api.js';
import { extractMediaFromPosts } from './media.js';
import {
    initElements,
    getElements,
    renderSlideshow,
    showUI,
    showLoading,
    showEmptyState,
    showWelcomeState,
    hideEmptyState,
    showError,
    hideError,
    showNavHint,
    setLoadButtonDisabled,
    updateNSFWToggle
} from './ui.js';
import {
    initEventListeners,
    cleanupEventListeners,
    stopAutoplay,
    resetZoom
} from './controls.js';
import { initAutocomplete, destroyAutocomplete } from './autocomplete.js';

/**
 * Loads user preferences from localStorage
 */
function loadPreferences() {
    const prefs = storage.get(CONFIG.storage.PREFERENCES_KEY, {});

    if (prefs.showNSFW !== undefined) {
        store.setState({ showNSFW: prefs.showNSFW });
        updateNSFWToggle(prefs.showNSFW);
    }

    if (prefs.autoplaySpeed !== undefined) {
        store.setState({ autoplaySpeed: prefs.autoplaySpeed });
        const elements = getElements();
        if (elements.speedSelect) {
            elements.speedSelect.value = prefs.autoplaySpeed.toString();
        }
    }

    if (prefs.lastSubreddit) {
        const elements = getElements();
        if (elements.subredditInput) {
            elements.subredditInput.value = prefs.lastSubreddit;
        }
    }
}

/**
 * Saves user preferences to localStorage
 */
function savePreferences() {
    const state = store.getState();

    storage.set(CONFIG.storage.PREFERENCES_KEY, {
        showNSFW: state.showNSFW,
        autoplaySpeed: state.autoplaySpeed,
        lastSubreddit: state.subreddit
    });
}

/**
 * Loads content from a subreddit
 *
 * @param {string} subreddit - Subreddit name to load
 * @returns {Promise<void>}
 */
async function loadSubreddit(subreddit) {
    // Clean up current state
    stopAutoplay();
    resetZoom();

    // Reset state for new load
    store.setState({
        subreddit,
        slides: [],
        currentIndex: 0,
        after: null,
        loading: true
    });
    store.get('preloadedImages').clear();

    // Update UI
    setLoadButtonDisabled(true);
    hideError();
    showLoading();

    try {
        // Fetch posts from Reddit
        const { posts, after } = await fetchPosts({
            subreddit,
            sort: store.get('sort'),
            time: store.get('time')
        });

        // Extract media from posts
        const slides = extractMediaFromPosts(posts, {
            showNSFW: store.get('showNSFW')
        });

        // Update state with results
        store.setState({
            slides,
            after,
            loading: false
        });

        // Handle results
        if (slides.length === 0) {
            showEmptyState('No media found', 'Try a different subreddit');
        } else {
            hideEmptyState();
            renderSlideshow();
            showUI();

            // Show navigation hint on first load
            if (store.get('firstLoad')) {
                store.setState({ firstLoad: false });
                showNavHint();
            }

            // Save preferences
            savePreferences();
        }
    } catch (error) {
        console.error('Failed to load subreddit:', error);
        store.setState({ loading: false });
        showError(error.message || 'Failed to load');
    } finally {
        setLoadButtonDisabled(false);
    }
}

/**
 * Handles subreddit form submission
 *
 * @param {Event} e - Form submit event
 */
function handleFormSubmit(e) {
    e.preventDefault();

    const elements = getElements();
    const rawInput = elements.subredditInput?.value || '';
    const subreddit = parseSubredditInput(rawInput);

    if (subreddit) {
        loadSubreddit(subreddit);
    }
}

/**
 * Initializes the application
 */
function init() {
    // Initialize DOM element references
    initElements();

    const elements = getElements();

    // Load saved preferences
    loadPreferences();

    // Set up form submission
    if (elements.subredditForm) {
        elements.subredditForm.addEventListener('submit', handleFormSubmit);
    }

    // Initialize all event listeners
    initEventListeners({
        onLoadSubreddit: () => {
            const subreddit = store.get('subreddit');
            if (subreddit) {
                loadSubreddit(subreddit);
            }
        }
    });

    // Save preferences on state changes
    store.subscribe((newState, prevState) => {
        // Save when certain values change
        if (newState.showNSFW !== prevState.showNSFW ||
            newState.autoplaySpeed !== prevState.autoplaySpeed) {
            savePreferences();
        }
    });

    // Show welcome state
    showWelcomeState();

    // Initialize autocomplete
    const autocompleteDropdown = document.getElementById('autocompleteDropdown');
    if (elements.subredditInput && autocompleteDropdown) {
        initAutocomplete(elements.subredditInput, autocompleteDropdown);
    }

    // Focus input for quick typing
    if (elements.subredditInput) {
        elements.subredditInput.focus();
    }

    // Log initialization
    console.log('Reddit Viewer initialized');
    console.log('Keyboard shortcuts: ← → (navigate), F (fullscreen), Z (zoom), P (autoplay)');
}

/**
 * Cleans up the application
 */
function cleanup() {
    cleanupEventListeners();
    destroyAutocomplete();
    stopAutoplay();
    savePreferences();
}

// Handle page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', cleanup);
}

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

// Export for external use
export {
    init,
    cleanup,
    loadSubreddit,
    loadPreferences,
    savePreferences
};

// Make app functions available globally
if (typeof window !== 'undefined') {
    window.app = {
        init,
        cleanup,
        loadSubreddit,
        loadPreferences,
        savePreferences
    };
}

export default {
    init,
    cleanup,
    loadSubreddit
};
