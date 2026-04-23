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
import { fetchPosts, fetchInstagramProfile, isValidInstagramUsername, isValidSubreddit } from './api.js';
import { extractMediaFromPosts, extractInstagramMedia } from './media.js';
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
    resetZoom,
    triggerInitialPreload
} from './controls.js';
import { initAutocomplete, destroyAutocomplete } from './autocomplete.js';

/**
 * Updates UI to match the currently selected provider
 * (placeholder text, visibility of sort controls, dropdown value)
 */
function applyProviderUI(provider) {
    const elements = getElements();

    if (elements.providerSelect && elements.providerSelect.value !== provider) {
        elements.providerSelect.value = provider;
    }

    if (elements.subredditInput) {
        elements.subredditInput.placeholder = provider === 'instagram'
            ? 'Instagram username (e.g. nasa)'
            : 'pics+earthporn or subreddit...';
    }

    // Hide sort/time controls for Instagram (no server-side sort available)
    if (elements.sortRow) {
        elements.sortRow.classList.toggle('provider-instagram', provider === 'instagram');
    }
}

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

    if (prefs.provider === 'instagram' || prefs.provider === 'reddit') {
        store.setState({ provider: prefs.provider });
    }

    if (prefs.lastSubreddit) {
        const elements = getElements();
        if (elements.subredditInput) {
            elements.subredditInput.value = prefs.lastSubreddit;
        }
    }

    applyProviderUI(store.get('provider'));
}

/**
 * Saves user preferences to localStorage
 */
function savePreferences() {
    const state = store.getState();

    storage.set(CONFIG.storage.PREFERENCES_KEY, {
        showNSFW: state.showNSFW,
        autoplaySpeed: state.autoplaySpeed,
        provider: state.provider,
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
        provider: 'reddit',
        slides: [],
        currentIndex: 0,
        after: null,
        igUserId: null,
        igNextMaxId: null,
        igMoreAvailable: false,
        loading: true
    });
    store.get('preloadedImages').clear();
    store.get('preloadedVideoUrls').clear();
    store.get('preloadedVideos').clear();
    store.get('preloadingInProgress').clear();

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

            // Trigger preloading for upcoming videos (TikTok-style instant playback)
            triggerInitialPreload();

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
 * Loads content from an Instagram profile
 *
 * @param {string} username - Instagram username (without @)
 * @returns {Promise<void>}
 */
async function loadInstagram(username) {
    stopAutoplay();
    resetZoom();

    store.setState({
        subreddit: username,       // reused by UI for display purposes
        provider: 'instagram',
        slides: [],
        currentIndex: 0,
        after: null,
        igUserId: null,
        igNextMaxId: null,
        igMoreAvailable: false,
        loading: true
    });
    store.get('preloadedImages').clear();
    store.get('preloadedVideoUrls').clear();
    store.get('preloadedVideos').clear();
    store.get('preloadingInProgress').clear();

    setLoadButtonDisabled(true);
    hideError();
    showLoading();

    try {
        const { user, items, itemFormat, moreAvailable, nextMaxId } =
            await fetchInstagramProfile(username);

        const slides = extractInstagramMedia(items, user?.username || username, itemFormat);

        store.setState({
            slides,
            igUserId: user?.id || null,
            igNextMaxId: nextMaxId,
            igMoreAvailable: moreAvailable,
            loading: false
        });

        if (slides.length === 0) {
            showEmptyState('No media found', `@${username} has no public media`);
        } else {
            hideEmptyState();
            renderSlideshow();
            showUI();

            if (store.get('firstLoad')) {
                store.setState({ firstLoad: false });
                showNavHint();
            }

            triggerInitialPreload();
            savePreferences();
        }
    } catch (error) {
        console.error('Failed to load Instagram profile:', error);
        store.setState({ loading: false });
        const message = error.status === 404
            ? 'Profile not found'
            : error.status === 403
            ? 'Profile is private or blocked'
            : error.message || 'Failed to load Instagram profile';
        showError(message);
    } finally {
        setLoadButtonDisabled(false);
    }
}

/**
 * Dispatches a load request to the correct provider
 */
function loadContent(rawInput) {
    const provider = store.get('provider');
    const cleaned = (rawInput || '').trim().replace(/^@/, '');

    if (provider === 'instagram') {
        const username = cleaned.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
        if (!isValidInstagramUsername(username)) {
            showError('Invalid Instagram username');
            return;
        }
        loadInstagram(username);
        return;
    }

    const subreddit = parseSubredditInput(rawInput);
    if (!subreddit || !isValidSubreddit(subreddit)) {
        showError('Invalid subreddit name');
        return;
    }
    loadSubreddit(subreddit);
}

/**
 * Handles form submission
 *
 * @param {Event} e - Form submit event
 */
function handleFormSubmit(e) {
    e.preventDefault();

    const elements = getElements();
    const rawInput = elements.subredditInput?.value || '';

    if (rawInput.trim()) {
        loadContent(rawInput);
    }
}

/**
 * Handles provider dropdown changes
 */
function handleProviderChange() {
    const elements = getElements();
    if (!elements.providerSelect) return;

    const provider = elements.providerSelect.value;
    store.setState({ provider });
    applyProviderUI(provider);
    savePreferences();
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

    // Provider dropdown
    if (elements.providerSelect) {
        elements.providerSelect.addEventListener('change', handleProviderChange);
    }

    // Initialize all event listeners
    initEventListeners({
        onLoadSubreddit: () => {
            const target = store.get('subreddit');
            if (!target) return;
            if (store.get('provider') === 'instagram') {
                loadInstagram(target);
            } else {
                loadSubreddit(target);
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
    loadInstagram,
    loadContent,
    loadPreferences,
    savePreferences
};

// Make app functions available globally
if (typeof window !== 'undefined') {
    window.app = {
        init,
        cleanup,
        loadSubreddit,
        loadInstagram,
        loadContent,
        loadPreferences,
        savePreferences
    };
}

export default {
    init,
    cleanup,
    loadSubreddit,
    loadInstagram,
    loadContent
};
