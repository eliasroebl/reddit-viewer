/**
 * Reddit Viewer - UI Module
 *
 * Handles all UI updates, rendering, and visual state management.
 * Provides functions for updating the slideshow, controls, and indicators.
 *
 * @module ui
 */

import CONFIG from './config.js';
import { store } from './state.js';
import { escapeHtml, formatSlideCount } from './utils.js';
import { fetchExternalVideoUrl } from './media.js';

/**
 * Cached DOM element references
 * Populated by initElements() on app start
 * @type {Object<string, HTMLElement>}
 */
let elements = {};

/**
 * Initializes DOM element references
 * Should be called once on app startup
 *
 * @returns {Object} Object containing all element references
 */
export function initElements() {
    elements = {};

    // Get all elements defined in config
    Object.entries(CONFIG.elements).forEach(([key, id]) => {
        const element = document.getElementById(id);
        if (element) {
            // Convert UPPER_SNAKE to camelCase for easier access
            const camelKey = key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            elements[camelKey] = element;
        }
    });

    return elements;
}

/**
 * Gets the cached element references
 *
 * @returns {Object} Object containing all element references
 */
export function getElements() {
    return elements;
}

/**
 * Gets a specific element by key
 *
 * @param {string} key - Element key (camelCase)
 * @returns {HTMLElement|undefined} Element or undefined
 */
export function getElement(key) {
    return elements[key];
}

/**
 * Gets the active slide image element
 *
 * @returns {HTMLImageElement|null} Active image or null
 */
export function getActiveImage() {
    return elements.slideshow?.querySelector('.slide.active img') || null;
}

/**
 * Gets the active slide video element
 *
 * @returns {HTMLVideoElement|null} Active video or null
 */
export function getActiveVideo() {
    return elements.slideshow?.querySelector('.slide.active video') || null;
}

/**
 * Creates a slide element for the slideshow
 *
 * @param {Object} data - Slide data
 * @param {string} position - Slide position (prev, active, next)
 * @returns {HTMLElement} Slide element
 * @private
 */
function createSlideElement(data, position) {
    const slide = document.createElement('div');
    slide.className = `slide ${position}`;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-label', `Slide: ${data.title}`);

    if (data.type === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.loop = true;
        video.playsInline = true;
        video.muted = true;
        video.preload = 'auto';
        video.setAttribute('aria-label', data.title);
        video.crossOrigin = 'anonymous';

        // Add error handling for debugging
        video.onerror = (e) => {
            console.error('Video error:', video.error?.message || 'Unknown error', 'Code:', video.error?.code, 'URL:', video.src);
        };

        if (position === 'active') {
            video.autoplay = true;
        }

        // Handle external videos that need URL resolution
        if (data.needsResolve && data.externalVideoId) {
            video.poster = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" x="50" text-anchor="middle" fill="white" font-size="12">Loading...</text></svg>';
            fetchExternalVideoUrl(data.externalVideoId).then(url => {
                if (url) {
                    console.log('Setting video src:', url);
                    video.src = url;
                    // Update slide data for future use
                    data.url = url;
                    data.needsResolve = false;
                } else {
                    video.poster = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" x="50" text-anchor="middle" fill="gray" font-size="8">Video unavailable</text></svg>';
                }
            });
        } else {
            video.src = data.url;
        }

        slide.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = data.url;
        img.alt = data.title;
        img.draggable = false;

        slide.appendChild(img);
    }

    return slide;
}

/**
 * Updates the slideshow with current, previous, and next slides
 *
 * Renders only 3 slides at a time for performance:
 * - Previous slide (offset -1)
 * - Current active slide (offset 0)
 * - Next slide (offset +1)
 */
export function updateSlides() {
    const container = elements.slideshow;
    if (!container) return;

    const slides = store.get('slides');
    const currentIndex = store.get('currentIndex');

    // Remove existing slides
    container.querySelectorAll('.slide').forEach(s => s.remove());

    // Render prev, current, and next slides
    const offsets = [-1, 0, 1];
    const positions = ['prev', 'active', 'next'];

    offsets.forEach((offset, i) => {
        const idx = currentIndex + offset;

        // Skip if index is out of bounds
        if (idx < 0 || idx >= slides.length) return;

        const data = slides[idx];
        const slide = createSlideElement(data, positions[i]);
        container.appendChild(slide);
    });
}

/**
 * Updates all UI elements to reflect current state
 *
 * Updates:
 * - Counter display
 * - Post title and link
 * - Meta info (subreddit, gallery indicator, source badge)
 * - Gallery dots
 * - UI visibility
 */
export function updateUI() {
    const slides = store.get('slides');
    const currentIndex = store.get('currentIndex');
    const uiVisible = store.get('uiVisible');
    const data = slides[currentIndex];

    if (!data) return;

    // Update counter
    if (elements.counter) {
        elements.counter.textContent = formatSlideCount(currentIndex, slides.length);
        elements.counter.classList.toggle('hidden', !uiVisible);
    }

    // Update title with link
    if (elements.postTitle) {
        elements.postTitle.innerHTML = `<a href="${data.permalink}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.title)}</a>`;
    }

    // Update meta info
    if (elements.postMeta) {
        let meta = `r/${escapeHtml(data.subreddit)}`;

        // Gallery indicator
        if (data.isGallery) {
            meta += ` <span class="gallery-indicator" aria-label="Gallery image ${data.galleryIndex} of ${data.galleryTotal}">📷 ${data.galleryIndex}/${data.galleryTotal}</span>`;
        }

        // Source badge for external media
        if (data.source && data.source !== 'reddit') {
            meta += ` <span class="source-badge">${escapeHtml(data.source)}</span>`;
        }

        elements.postMeta.innerHTML = meta;
    }

    // Update gallery dots
    updateGalleryDots(data);

    // Update visibility classes
    if (elements.bottomBar) {
        elements.bottomBar.classList.toggle('hidden', !uiVisible);
    }
}

/**
 * Updates the gallery dots indicator
 *
 * @param {Object} data - Current slide data
 * @private
 */
function updateGalleryDots(data) {
    if (!elements.galleryDots) return;

    // Only show dots for galleries with 20 or fewer items
    if (data.isGallery && data.galleryTotal <= 20) {
        let dots = '';

        for (let i = 1; i <= data.galleryTotal; i++) {
            const isActive = i === data.galleryIndex;
            dots += `<div class="gallery-dot${isActive ? ' active' : ''}" aria-hidden="true"></div>`;
        }

        elements.galleryDots.innerHTML = dots;
        elements.galleryDots.style.display = 'flex';
        elements.galleryDots.setAttribute('aria-label', `Gallery position ${data.galleryIndex} of ${data.galleryTotal}`);
    } else {
        elements.galleryDots.style.display = 'none';
    }
}

/**
 * Renders the complete slideshow
 * Called after initial load or when content changes
 */
export function renderSlideshow() {
    if (!elements.slideshow) return;

    elements.slideshow.querySelectorAll('.slide').forEach(s => s.remove());
    updateSlides();
    updateUI();
}

/**
 * Toggles UI visibility (header, bottom bar, counter)
 */
export function toggleUI() {
    const current = store.get('uiVisible');
    store.setState({ uiVisible: !current });

    const visible = store.get('uiVisible');

    if (elements.header) {
        elements.header.classList.toggle('hidden', !visible);
    }
    if (elements.bottomBar) {
        elements.bottomBar.classList.toggle('hidden', !visible);
    }
    if (elements.counter) {
        elements.counter.classList.toggle('hidden', !visible);
    }
}

/**
 * Shows the UI (header, bottom bar, counter)
 */
export function showUI() {
    store.setState({ uiVisible: true });

    if (elements.header) {
        elements.header.classList.remove('hidden');
    }
    if (elements.bottomBar) {
        elements.bottomBar.classList.remove('hidden');
    }
    if (elements.counter) {
        elements.counter.classList.remove('hidden');
    }
}

/**
 * Hides the UI (header, bottom bar, counter)
 */
export function hideUI() {
    store.setState({ uiVisible: false });

    if (elements.header) {
        elements.header.classList.add('hidden');
    }
    if (elements.bottomBar) {
        elements.bottomBar.classList.add('hidden');
    }
    if (elements.counter) {
        elements.counter.classList.add('hidden');
    }
}

/**
 * Shows the loading state
 */
export function showLoading() {
    if (elements.emptyState) {
        elements.emptyState.style.display = 'flex';
        elements.emptyState.innerHTML = `
            <div class="loading" role="status" aria-live="polite">
                <div class="spinner" aria-hidden="true"></div>
                <p>Loading...</p>
            </div>
        `;
    }

    if (elements.bottomBar) {
        elements.bottomBar.classList.add('hidden');
    }
    if (elements.counter) {
        elements.counter.classList.add('hidden');
    }
}

/**
 * Shows the empty state message
 *
 * @param {string} [title='No media found'] - Title text
 * @param {string} [message='Try a different subreddit'] - Message text
 */
export function showEmptyState(title = 'No media found', message = 'Try a different subreddit') {
    if (elements.emptyState) {
        elements.emptyState.style.display = 'flex';
        elements.emptyState.innerHTML = `
            <div class="empty-state" role="status">
                <h2>${escapeHtml(title)}</h2>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }
}

/**
 * Shows the initial welcome state
 */
export function showWelcomeState() {
    if (elements.emptyState) {
        elements.emptyState.style.display = 'flex';
        elements.emptyState.innerHTML = `
            <div class="empty-state">
                <h2>Reddit Viewer</h2>
                <p>Enter a subreddit to start browsing</p>
            </div>
        `;
    }
}

/**
 * Hides the empty/loading state
 */
export function hideEmptyState() {
    if (elements.emptyState) {
        elements.emptyState.style.display = 'none';
    }
}

/**
 * Shows an error message
 *
 * @param {string} message - Error message to display
 */
export function showError(message) {
    if (elements.error) {
        elements.error.textContent = message;
        elements.error.style.display = 'block';
        elements.error.setAttribute('role', 'alert');
    }

    showEmptyState('Error', 'Could not load subreddit');
}

/**
 * Hides the error message
 */
export function hideError() {
    if (elements.error) {
        elements.error.style.display = 'none';
    }
}

/**
 * Shows swipe feedback indicator
 *
 * @param {string} direction - Direction ('left' or 'right')
 */
export function showSwipeFeedback(direction) {
    const element = direction === 'left'
        ? elements.swipeFeedbackLeft
        : elements.swipeFeedbackRight;

    if (element) {
        element.classList.add('show');
        setTimeout(() => {
            element.classList.remove('show');
        }, CONFIG.timing.SWIPE_FEEDBACK_DURATION);
    }
}

/**
 * Shows the navigation hint (on first load)
 */
export function showNavHint() {
    if (elements.navHint) {
        elements.navHint.classList.add('show');
        setTimeout(() => {
            elements.navHint.classList.remove('show');
        }, CONFIG.timing.NAV_HINT_DURATION);
    }
}

/**
 * Shows the zoom indicator
 *
 * @param {number} scale - Current zoom scale
 */
export function showZoomIndicator(scale) {
    if (elements.zoomIndicator) {
        elements.zoomIndicator.textContent = `${scale}x Zoom`;
        elements.zoomIndicator.classList.add('show');
        setTimeout(() => {
            elements.zoomIndicator.classList.remove('show');
        }, CONFIG.timing.ZOOM_INDICATOR_DURATION);
    }
}

/**
 * Updates the fullscreen button state
 *
 * @param {boolean} isFullscreen - Whether currently in fullscreen
 */
export function updateFullscreenButton(isFullscreen) {
    if (elements.fullscreenBtn) {
        elements.fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
        elements.fullscreenBtn.setAttribute('aria-pressed', isFullscreen.toString());
    }
}

/**
 * Updates the autoplay button state
 *
 * @param {boolean} isPlaying - Whether autoplay is active
 */
export function updateAutoplayButton(isPlaying) {
    if (elements.autoplayBtn) {
        elements.autoplayBtn.classList.toggle('playing', isPlaying);
        elements.autoplayBtn.textContent = isPlaying ? '⏸' : '▶';
        elements.autoplayBtn.title = isPlaying ? 'Pause' : 'Autoplay';
        elements.autoplayBtn.setAttribute('aria-pressed', isPlaying.toString());
    }
}

/**
 * Updates the NSFW toggle state
 *
 * @param {boolean} isActive - Whether NSFW content is shown
 */
export function updateNSFWToggle(isActive) {
    if (elements.nsfwToggle) {
        elements.nsfwToggle.classList.toggle('active', isActive);
        elements.nsfwToggle.setAttribute('aria-pressed', isActive.toString());
    }
}

/**
 * Sets the load button disabled state
 *
 * @param {boolean} disabled - Whether button should be disabled
 */
export function setLoadButtonDisabled(disabled) {
    if (elements.loadBtn) {
        elements.loadBtn.disabled = disabled;
        elements.loadBtn.setAttribute('aria-busy', disabled.toString());
    }
}

/**
 * Updates the time select visibility
 *
 * @param {boolean} visible - Whether to show time select
 */
export function setTimeSelectVisible(visible) {
    if (elements.timeSelect) {
        elements.timeSelect.style.display = visible ? 'inline-block' : 'none';
    }
}

/**
 * Applies zoom transform to the active image
 *
 * @param {boolean} isZoomed - Whether image should be zoomed
 * @param {number} scale - Zoom scale
 * @param {number} panX - Pan X offset
 * @param {number} panY - Pan Y offset
 */
export function applyZoomTransform(isZoomed, scale, panX, panY) {
    const img = getActiveImage();
    if (!img) return;

    if (isZoomed) {
        img.classList.add('zoomed');
        img.style.transform = `scale(${scale}) translate(${panX}px, ${panY}px)`;
    } else {
        img.classList.remove('zoomed', 'dragging');
        img.style.transform = '';
    }
}

/**
 * Sets the dragging state on the active image
 *
 * @param {boolean} isDragging - Whether currently dragging
 */
export function setImageDragging(isDragging) {
    const img = getActiveImage();
    if (img) {
        img.classList.toggle('dragging', isDragging);
    }
}

// Make UI functions available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.ui = {
        initElements,
        getElements,
        getElement,
        getActiveImage,
        getActiveVideo,
        updateSlides,
        updateUI,
        renderSlideshow,
        toggleUI,
        showUI,
        hideUI,
        showLoading,
        showEmptyState,
        showWelcomeState,
        hideEmptyState,
        showError,
        hideError,
        showSwipeFeedback,
        showNavHint,
        showZoomIndicator,
        updateFullscreenButton,
        updateAutoplayButton,
        updateNSFWToggle,
        setLoadButtonDisabled,
        setTimeSelectVisible,
        applyZoomTransform,
        setImageDragging
    };
}

export default {
    initElements,
    getElements,
    getElement,
    getActiveImage,
    getActiveVideo,
    updateSlides,
    updateUI,
    renderSlideshow,
    toggleUI,
    showUI,
    hideUI,
    showLoading,
    showEmptyState,
    showWelcomeState,
    hideEmptyState,
    showError,
    hideError,
    showSwipeFeedback,
    showNavHint,
    showZoomIndicator,
    updateFullscreenButton,
    updateAutoplayButton,
    updateNSFWToggle,
    setLoadButtonDisabled,
    setTimeSelectVisible,
    applyZoomTransform,
    setImageDragging
};
