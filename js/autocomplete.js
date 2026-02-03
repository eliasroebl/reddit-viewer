/**
 * Reddit Viewer - Autocomplete Module
 *
 * Provides subreddit search autocomplete functionality.
 * Handles the + separator for multi-subreddit queries.
 *
 * @module autocomplete
 */

import CONFIG from './config.js';
import { debounce, escapeHtml } from './utils.js';
import { jsonp } from './api.js';

/**
 * Autocomplete configuration
 * @constant {Object}
 */
const AUTOCOMPLETE_CONFIG = {
    /** Minimum characters before searching */
    MIN_CHARS: 3,

    /** Debounce delay for search requests */
    DEBOUNCE_MS: 250,

    /** Maximum results to show */
    MAX_RESULTS: 8,

    /** API endpoint for subreddit autocomplete (supports JSONP) */
    SEARCH_URL: 'https://www.reddit.com/api/subreddit_autocomplete_v2.json'
};

/**
 * Autocomplete state
 * @type {Object}
 */
const state = {
    /** Currently highlighted index */
    highlightedIndex: -1,

    /** Current search results */
    results: [],

    /** Whether dropdown is visible */
    isOpen: false,

    /** Current search query */
    currentQuery: '',

    /** Abort controller for pending requests */
    abortController: null
};

/**
 * DOM element references
 * @type {Object}
 */
let elements = {
    input: null,
    dropdown: null
};

/**
 * Formats subscriber count for display
 *
 * @param {number} count - Subscriber count
 * @returns {string} Formatted string (e.g., "1.2M subscribers")
 */
function formatSubscribers(count) {
    if (!count) return '';

    if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M subscribers`;
    }
    if (count >= 1000) {
        return `${(count / 1000).toFixed(0)}K subscribers`;
    }
    return `${count} subscribers`;
}

/**
 * Highlights the matching portion of a subreddit name
 *
 * @param {string} name - Subreddit name
 * @param {string} query - Search query
 * @returns {string} HTML with highlighted match
 */
function highlightMatch(name, query) {
    const lowerName = name.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerName.indexOf(lowerQuery);

    if (index === -1) {
        return escapeHtml(name);
    }

    const before = escapeHtml(name.slice(0, index));
    const match = escapeHtml(name.slice(index, index + query.length));
    const after = escapeHtml(name.slice(index + query.length));

    return `${before}<strong>${match}</strong>${after}`;
}

/**
 * Extracts the current search term from input value
 * Handles the + separator for multi-subreddit queries
 *
 * @param {string} value - Full input value
 * @returns {Object} { searchTerm, prefix }
 */
function extractSearchTerm(value) {
    const lastPlusIndex = value.lastIndexOf('+');

    if (lastPlusIndex === -1) {
        return {
            searchTerm: value.trim(),
            prefix: ''
        };
    }

    return {
        searchTerm: value.slice(lastPlusIndex + 1).trim(),
        prefix: value.slice(0, lastPlusIndex + 1)
    };
}

/**
 * Searches for subreddits matching the query
 *
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of subreddit objects
 */
async function searchSubreddits(query) {
    if (!query || query.length < AUTOCOMPLETE_CONFIG.MIN_CHARS) {
        return [];
    }

    const url = `${AUTOCOMPLETE_CONFIG.SEARCH_URL}?query=${encodeURIComponent(query)}&limit=${AUTOCOMPLETE_CONFIG.MAX_RESULTS}&include_over_18=true&raw_json=1&include_profiles=false`;

    try {
        const data = await jsonp(url);

        // Handle the autocomplete_v2 response format
        if (!data?.data?.children) {
            return [];
        }

        return data.data.children
            .filter(child => child.kind === 't5') // t5 = subreddit
            .map(child => ({
                name: child.data.display_name,
                subscribers: child.data.subscribers,
                icon: child.data.icon_img || child.data.community_icon?.split('?')[0] || null,
                nsfw: child.data.over18
            }));
    } catch (error) {
        console.warn('Subreddit search failed:', error);
        return [];
    }
}

/**
 * Renders the dropdown with results
 *
 * @param {Array} results - Search results
 * @param {string} query - Current query for highlighting
 */
function renderDropdown(results, query) {
    state.results = results;
    state.highlightedIndex = -1;

    if (results.length === 0) {
        elements.dropdown.innerHTML = `
            <div class="autocomplete-empty">
                No subreddits found for "${escapeHtml(query)}"
            </div>
        `;
        return;
    }

    const html = results.map((sub, index) => {
        const iconHtml = sub.icon
            ? `<img src="${escapeHtml(sub.icon)}" alt="" loading="lazy">`
            : 'r/';

        return `
            <div
                class="autocomplete-item"
                data-index="${index}"
                data-name="${escapeHtml(sub.name)}"
                role="option"
                aria-selected="false"
            >
                <div class="autocomplete-item-icon">${iconHtml}</div>
                <div class="autocomplete-item-info">
                    <div class="autocomplete-item-name">r/${highlightMatch(sub.name, query)}</div>
                    <div class="autocomplete-item-subscribers">${formatSubscribers(sub.subscribers)}</div>
                </div>
            </div>
        `;
    }).join('');

    elements.dropdown.innerHTML = html;
}

/**
 * Shows loading state in dropdown
 */
function showLoading() {
    elements.dropdown.innerHTML = `
        <div class="autocomplete-loading">Searching...</div>
    `;
    showDropdown();
}

/**
 * Shows the dropdown
 */
function showDropdown() {
    state.isOpen = true;
    elements.dropdown.classList.add('visible');
    elements.input.setAttribute('aria-expanded', 'true');
}

/**
 * Hides the dropdown
 */
function hideDropdown() {
    state.isOpen = false;
    state.highlightedIndex = -1;
    state.results = [];
    elements.dropdown.classList.remove('visible');
    elements.input.setAttribute('aria-expanded', 'false');

    // Remove highlights
    elements.dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.classList.remove('highlighted');
        item.setAttribute('aria-selected', 'false');
    });
}

/**
 * Updates the highlighted item
 *
 * @param {number} newIndex - New index to highlight
 */
function updateHighlight(newIndex) {
    const items = elements.dropdown.querySelectorAll('.autocomplete-item');

    // Remove current highlight
    if (state.highlightedIndex >= 0 && items[state.highlightedIndex]) {
        items[state.highlightedIndex].classList.remove('highlighted');
        items[state.highlightedIndex].setAttribute('aria-selected', 'false');
    }

    // Clamp new index
    if (newIndex < 0) {
        newIndex = items.length - 1;
    } else if (newIndex >= items.length) {
        newIndex = 0;
    }

    state.highlightedIndex = newIndex;

    // Apply new highlight
    if (items[newIndex]) {
        items[newIndex].classList.add('highlighted');
        items[newIndex].setAttribute('aria-selected', 'true');
        items[newIndex].scrollIntoView({ block: 'nearest' });
    }
}

/**
 * Selects a subreddit from the results
 *
 * @param {string} name - Subreddit name to select
 */
function selectSubreddit(name) {
    const { prefix } = extractSearchTerm(elements.input.value);
    elements.input.value = prefix + name;
    hideDropdown();
    elements.input.focus();
}

/**
 * Handles input changes
 */
const handleInput = debounce(async () => {
    const { searchTerm } = extractSearchTerm(elements.input.value);
    state.currentQuery = searchTerm;

    if (searchTerm.length < AUTOCOMPLETE_CONFIG.MIN_CHARS) {
        hideDropdown();
        return;
    }

    showLoading();

    const results = await searchSubreddits(searchTerm);

    // Check if query changed while we were searching
    const { searchTerm: currentTerm } = extractSearchTerm(elements.input.value);
    if (currentTerm !== searchTerm) {
        return;
    }

    if (results.length === 0 && searchTerm.length >= AUTOCOMPLETE_CONFIG.MIN_CHARS) {
        renderDropdown([], searchTerm);
        showDropdown();
    } else if (results.length > 0) {
        renderDropdown(results, searchTerm);
        showDropdown();
    } else {
        hideDropdown();
    }
}, AUTOCOMPLETE_CONFIG.DEBOUNCE_MS);

/**
 * Handles keyboard navigation
 *
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeydown(e) {
    if (!state.isOpen) {
        return;
    }

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            updateHighlight(state.highlightedIndex + 1);
            break;

        case 'ArrowUp':
            e.preventDefault();
            updateHighlight(state.highlightedIndex - 1);
            break;

        case 'Enter':
            if (state.highlightedIndex >= 0 && state.results[state.highlightedIndex]) {
                e.preventDefault();
                selectSubreddit(state.results[state.highlightedIndex].name);
            }
            break;

        case 'Escape':
            e.preventDefault();
            hideDropdown();
            break;

        case 'Tab':
            hideDropdown();
            break;
    }
}

/**
 * Handles clicks on dropdown items
 *
 * @param {MouseEvent} e - Click event
 */
function handleDropdownClick(e) {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
        const name = item.dataset.name;
        selectSubreddit(name);
    }
}

/**
 * Handles clicks outside the autocomplete
 *
 * @param {MouseEvent} e - Click event
 */
function handleOutsideClick(e) {
    if (!elements.input.contains(e.target) && !elements.dropdown.contains(e.target)) {
        hideDropdown();
    }
}

/**
 * Handles focus on input
 */
function handleFocus() {
    const { searchTerm } = extractSearchTerm(elements.input.value);
    if (searchTerm.length >= AUTOCOMPLETE_CONFIG.MIN_CHARS && state.results.length > 0) {
        showDropdown();
    }
}

/**
 * Initializes the autocomplete functionality
 *
 * @param {HTMLInputElement} inputElement - The input element
 * @param {HTMLElement} dropdownElement - The dropdown container element
 */
export function initAutocomplete(inputElement, dropdownElement) {
    elements.input = inputElement;
    elements.dropdown = dropdownElement;

    if (!elements.input || !elements.dropdown) {
        console.warn('Autocomplete: Missing required elements');
        return;
    }

    // Attach event listeners
    elements.input.addEventListener('input', handleInput);
    elements.input.addEventListener('keydown', handleKeydown);
    elements.input.addEventListener('focus', handleFocus);
    elements.dropdown.addEventListener('click', handleDropdownClick);
    document.addEventListener('click', handleOutsideClick);

    console.log('Autocomplete initialized');
}

/**
 * Destroys the autocomplete and removes event listeners
 */
export function destroyAutocomplete() {
    if (elements.input) {
        elements.input.removeEventListener('input', handleInput);
        elements.input.removeEventListener('keydown', handleKeydown);
        elements.input.removeEventListener('focus', handleFocus);
    }

    if (elements.dropdown) {
        elements.dropdown.removeEventListener('click', handleDropdownClick);
    }

    document.removeEventListener('click', handleOutsideClick);

    elements.input = null;
    elements.dropdown = null;
    state.results = [];
    state.isOpen = false;
}

/**
 * Gets the current state (for debugging)
 *
 * @returns {Object} Current state
 */
export function getState() {
    return { ...state };
}

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.autocomplete = {
        initAutocomplete,
        destroyAutocomplete,
        getState
    };
}

export default {
    initAutocomplete,
    destroyAutocomplete,
    getState
};
