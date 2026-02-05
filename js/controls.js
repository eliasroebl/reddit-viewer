/**
 * Reddit Viewer - Controls Module
 *
 * Handles all user interactions including keyboard, touch, and mouse events.
 * Provides event handler setup and cleanup functionality.
 *
 * @module controls
 */

import CONFIG from './config.js';
import { store, stateHelpers } from './state.js';
import { createEventController, isFullscreen } from './utils.js';
import {
    getElements,
    getActiveImage,
    getActiveVideo,
    updateSlides,
    updateUI,
    toggleUI,
    showUI,
    hideUI,
    showSwipeFeedback,
    showZoomIndicator,
    updateFullscreenButton,
    updateAutoplayButton,
    updateNSFWToggle,
    applyZoomTransform,
    setImageDragging,
    cleanupOldPreloads,
    preloadUpcomingVideos,
    startBufferMonitoring,
    stopBufferMonitoring
} from './ui.js';
import { fetchPosts } from './api.js';
import { extractMediaFromPosts, preloadExternalVideoUrls } from './media.js';

/**
 * Event controller for managing all event listeners
 * @type {Object}
 */
const eventController = createEventController();

/**
 * Touch state for gesture detection
 * @type {Object}
 */
const touchState = {
    startX: 0,
    startY: 0,
    startTime: 0,
    lastTapTime: 0,
    isPanning: false
};

/**
 * Mouse state for drag operations
 * @type {Object}
 */
const mouseState = {
    isDragging: false,
    startX: 0,
    startY: 0
};

/**
 * Navigates to the next or previous slide
 *
 * @param {number} direction - Navigation direction (-1 for prev, 1 for next)
 */
export function navigate(direction) {
    const currentIndex = store.get('currentIndex');
    const slides = store.get('slides');
    const newIdx = currentIndex + direction;

    // Check bounds
    if (newIdx < 0 || newIdx >= slides.length) return;

    // Reset zoom when navigating
    resetZoom();

    // Show swipe feedback
    showSwipeFeedback(direction < 0 ? 'left' : 'right');

    // Stop buffer monitoring for old video
    stopBufferMonitoring();

    // Pause current video
    const video = getActiveVideo();
    if (video) video.pause();

    // Update state - reset preloading pause for new slide
    store.setState({ currentIndex: newIdx, preloadingPaused: false });

    // Update display
    updateSlides();
    updateUI();

    // Start buffer monitoring if new slide is a video
    const newSlide = slides[newIdx];
    if (newSlide && newSlide.type === 'video') {
        // Delay slightly to let video start playing
        setTimeout(startBufferMonitoring, 100);
    }

    // Preload upcoming media (images and videos)
    preloadUpcomingMedia();

    // Cleanup old preloaded videos to free memory
    cleanupOldPreloads(newIdx);

    // Check if we need to load more posts
    if (stateHelpers.shouldPreloadPosts()) {
        loadMorePosts();
    }
}

/**
 * Preloads upcoming media (images and videos) for smoother navigation
 * This is the main preloading orchestration function
 */
function preloadUpcomingMedia() {
    const slides = store.get('slides');
    const currentIndex = store.get('currentIndex');
    const preloadedImages = store.get('preloadedImages');

    // 1. Preload upcoming images (existing behavior)
    for (let i = 1; i <= CONFIG.slideshow.PRELOAD_COUNT; i++) {
        const idx = currentIndex + i;
        if (idx >= slides.length) break;

        const data = slides[idx];
        if (data.type === 'image' && !preloadedImages.has(data.url)) {
            const img = new Image();
            img.src = data.url;
            preloadedImages.add(data.url);
        }
    }

    // 2. Pre-resolve external video URLs (Layer 1: URL Resolution Cache)
    preloadExternalVideoUrls(slides, currentIndex + 1, CONFIG.preloading.URL_PRELOAD_COUNT);

    // 3. Preload video elements for upcoming slides (Layer 2: Video Element Preloading)
    // Use a small delay to let URL resolution happen first
    setTimeout(() => {
        preloadUpcomingVideos(slides, currentIndex);
    }, 100);
}

/**
 * Triggers initial preloading after slides are loaded
 * Call this after loadSubreddit completes
 */
export function triggerInitialPreload() {
    const slides = store.get('slides');
    const currentIndex = store.get('currentIndex');

    if (slides.length === 0) return;

    // Start buffer monitoring if first slide is a video
    const firstSlide = slides[currentIndex];
    if (firstSlide && firstSlide.type === 'video') {
        setTimeout(startBufferMonitoring, 100);
    }

    // Pre-resolve external video URLs for first several slides
    preloadExternalVideoUrls(slides, currentIndex, CONFIG.preloading.URL_PRELOAD_COUNT);

    // After a delay, preload video elements
    setTimeout(() => {
        preloadUpcomingVideos(slides, currentIndex);
    }, 500);
}

/**
 * Loads more posts from the API
 */
async function loadMorePosts() {
    const state = store.getState();

    store.setState({ loading: true });

    try {
        const { posts, after } = await fetchPosts({
            subreddit: state.subreddit,
            sort: state.sort,
            time: state.time,
            after: state.after
        });

        const newSlides = extractMediaFromPosts(posts, { showNSFW: state.showNSFW });

        store.setState({
            slides: [...state.slides, ...newSlides],
            after,
            loading: false
        });

        updateUI();
    } catch (error) {
        console.error('Failed to load more posts:', error);
        store.setState({ loading: false });
    }
}

/**
 * Toggles fullscreen mode
 */
export function toggleFullscreen() {
    if (!isFullscreen()) {
        const el = document.documentElement;
        if (el.requestFullscreen) {
            el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

/**
 * Handles fullscreen change events
 */
function handleFullscreenChange() {
    const fullscreen = isFullscreen();
    updateFullscreenButton(fullscreen);

    // Auto-hide UI when entering fullscreen
    if (fullscreen) {
        hideUI();
    } else {
        showUI();
    }
}

/**
 * Toggles zoom on the current image
 */
export function toggleZoom() {
    const img = getActiveImage();
    if (!img) return;

    const isZoomed = store.get('isZoomed');
    const zoomScale = store.get('zoomScale');

    store.setState({
        isZoomed: !isZoomed,
        panX: 0,
        panY: 0
    });

    const newZoomed = store.get('isZoomed');
    applyZoomTransform(newZoomed, zoomScale, 0, 0);

    if (newZoomed) {
        showZoomIndicator(zoomScale);
    }
}

/**
 * Resets zoom state
 */
export function resetZoom() {
    store.setState({
        isZoomed: false,
        panX: 0,
        panY: 0,
        isPanning: false
    });

    const img = getActiveImage();
    if (img) {
        img.classList.remove('zoomed', 'dragging');
        img.style.transform = '';
    }
}

/**
 * Updates pan position while dragging
 *
 * @param {number} deltaX - X movement delta
 * @param {number} deltaY - Y movement delta
 */
function updatePan(deltaX, deltaY) {
    const zoomScale = store.get('zoomScale');
    const panX = store.get('panX') + deltaX / zoomScale;
    const panY = store.get('panY') + deltaY / zoomScale;

    store.setState({ panX, panY });

    const img = getActiveImage();
    applyZoomTransform(true, zoomScale, panX, panY);
}

/**
 * Starts autoplay mode
 */
export function startAutoplay() {
    if (!stateHelpers.hasSlides()) return;

    const autoplaySpeed = store.get('autoplaySpeed');

    const intervalId = setInterval(() => {
        if (!stateHelpers.isAtEnd()) {
            navigate(1);
        } else {
            stopAutoplay();
        }
    }, autoplaySpeed);

    store.setState({
        autoplay: true,
        autoplayInterval: intervalId
    });

    updateAutoplayButton(true);
}

/**
 * Stops autoplay mode
 */
export function stopAutoplay() {
    const intervalId = store.get('autoplayInterval');

    if (intervalId) {
        clearInterval(intervalId);
    }

    store.setState({
        autoplay: false,
        autoplayInterval: null
    });

    updateAutoplayButton(false);
}

/**
 * Toggles autoplay mode
 */
export function toggleAutoplay() {
    if (store.get('autoplay')) {
        stopAutoplay();
    } else {
        startAutoplay();
    }
}

/**
 * Handles autoplay speed change
 *
 * @param {number} speed - New speed in milliseconds
 */
export function setAutoplaySpeed(speed) {
    store.setState({ autoplaySpeed: speed });

    // Restart autoplay if active
    if (store.get('autoplay')) {
        stopAutoplay();
        startAutoplay();
    }
}

/**
 * Toggles NSFW content visibility
 *
 * @param {Function} reloadCallback - Callback to reload content
 */
export function toggleNSFW(reloadCallback) {
    const showNSFW = !store.get('showNSFW');
    store.setState({ showNSFW });
    updateNSFWToggle(showNSFW);

    // Reload content if we have a subreddit loaded
    if (store.get('subreddit') && reloadCallback) {
        reloadCallback();
    }
}

/**
 * Keyboard event handler
 *
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeydown(e) {
    // Ignore when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const isZoomed = store.get('isZoomed');
    const key = e.key;

    // Navigation (only when not zoomed)
    if (CONFIG.shortcuts.NAVIGATE_PREV.includes(key)) {
        if (!isZoomed) navigate(-1);
        return;
    }

    if (CONFIG.shortcuts.NAVIGATE_NEXT.includes(key)) {
        if (!isZoomed) navigate(1);
        e.preventDefault();
        return;
    }

    // Fullscreen toggle
    if (CONFIG.shortcuts.TOGGLE_FULLSCREEN.includes(key)) {
        toggleFullscreen();
        return;
    }

    // Zoom toggle
    if (CONFIG.shortcuts.TOGGLE_ZOOM.includes(key)) {
        toggleZoom();
        return;
    }

    // Autoplay toggle
    if (CONFIG.shortcuts.TOGGLE_AUTOPLAY.includes(key)) {
        toggleAutoplay();
        return;
    }

    // Escape - reset zoom or show UI
    if (CONFIG.shortcuts.SHOW_UI.includes(key)) {
        if (isZoomed) {
            resetZoom();
        } else {
            showUI();
        }
        return;
    }
}

/**
 * Touch start event handler
 *
 * @param {TouchEvent} e - Touch event
 */
function handleTouchStart(e) {
    // Ignore touches on header/bottom bar
    if (e.target.closest('.header') || e.target.closest('.bottom-bar')) return;

    touchState.startX = e.touches[0].clientX;
    touchState.startY = e.touches[0].clientY;
    touchState.startTime = Date.now();

    // Start panning if zoomed
    if (store.get('isZoomed')) {
        touchState.isPanning = true;
        store.setState({
            panStartX: touchState.startX,
            panStartY: touchState.startY
        });
        setImageDragging(true);
    }
}

/**
 * Touch move event handler
 *
 * @param {TouchEvent} e - Touch event
 */
function handleTouchMove(e) {
    if (!store.get('isZoomed') || !touchState.isPanning) return;
    if (e.target.closest('.header') || e.target.closest('.bottom-bar')) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const panStartX = store.get('panStartX');
    const panStartY = store.get('panStartY');

    const deltaX = currentX - panStartX;
    const deltaY = currentY - panStartY;

    updatePan(deltaX, deltaY);

    store.setState({
        panStartX: currentX,
        panStartY: currentY
    });
}

/**
 * Touch end event handler
 *
 * @param {TouchEvent} e - Touch event
 */
function handleTouchEnd(e) {
    // Ignore touches on header/bottom bar
    if (e.target.closest('.header') || e.target.closest('.bottom-bar')) return;

    const dx = e.changedTouches[0].clientX - touchState.startX;
    const dy = e.changedTouches[0].clientY - touchState.startY;
    const dt = Date.now() - touchState.startTime;

    // End panning
    if (touchState.isPanning) {
        touchState.isPanning = false;
        setImageDragging(false);
    }

    const isZoomed = store.get('isZoomed');

    // Handle zoomed state
    if (isZoomed) {
        // Double-tap to zoom out
        const timeSinceLastTap = Date.now() - touchState.lastTapTime;
        if (timeSinceLastTap < CONFIG.gestures.DOUBLE_TAP_DELAY &&
            Math.abs(dx) < CONFIG.gestures.TAP_THRESHOLD &&
            Math.abs(dy) < CONFIG.gestures.TAP_THRESHOLD) {
            resetZoom();
            touchState.lastTapTime = 0;
            return;
        }
        touchState.lastTapTime = Date.now();
        return;
    }

    // Double-tap detection for zoom
    const timeSinceLastTap = Date.now() - touchState.lastTapTime;
    if (timeSinceLastTap < CONFIG.gestures.DOUBLE_TAP_DELAY &&
        Math.abs(dx) < CONFIG.gestures.TAP_THRESHOLD &&
        Math.abs(dy) < CONFIG.gestures.TAP_THRESHOLD) {
        toggleZoom();
        touchState.lastTapTime = 0;
        return;
    }
    touchState.lastTapTime = Date.now();

    // Swipe detection (only when not zoomed)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > CONFIG.gestures.SWIPE_THRESHOLD) {
        navigate(dx > 0 ? -1 : 1);
        return;
    }

    // Single tap detection (with delay for double-tap)
    if (Math.abs(dx) < CONFIG.gestures.TAP_THRESHOLD &&
        Math.abs(dy) < CONFIG.gestures.TAP_THRESHOLD &&
        dt < CONFIG.gestures.TAP_MAX_DURATION) {
        setTimeout(() => {
            if (Date.now() - touchState.lastTapTime > 250) {
                toggleUI();
            }
        }, CONFIG.gestures.SINGLE_TAP_DELAY);
    }
}

/**
 * Mouse down event handler for pan
 *
 * @param {MouseEvent} e - Mouse event
 */
function handleMouseDown(e) {
    if (!store.get('isZoomed')) return;
    if (e.target.tagName !== 'IMG') return;

    mouseState.isDragging = true;
    mouseState.startX = e.clientX;
    mouseState.startY = e.clientY;

    setImageDragging(true);
    e.preventDefault();
}

/**
 * Mouse move event handler for pan
 *
 * @param {MouseEvent} e - Mouse event
 */
function handleMouseMove(e) {
    if (!mouseState.isDragging || !store.get('isZoomed')) return;

    const deltaX = e.clientX - mouseState.startX;
    const deltaY = e.clientY - mouseState.startY;

    updatePan(deltaX, deltaY);

    mouseState.startX = e.clientX;
    mouseState.startY = e.clientY;
}

/**
 * Mouse up event handler
 */
function handleMouseUp() {
    if (mouseState.isDragging) {
        mouseState.isDragging = false;
        setImageDragging(false);
    }
}

/**
 * Double-click event handler for zoom
 *
 * @param {MouseEvent} e - Mouse event
 */
function handleDoubleClick(e) {
    if (e.target.tagName === 'IMG') {
        toggleZoom();
    }
}

/**
 * Initializes all event listeners
 *
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onLoadSubreddit - Called when subreddit should be loaded
 */
export function initEventListeners(callbacks = {}) {
    const elements = getElements();

    // Fullscreen button
    if (elements.fullscreenBtn) {
        eventController.add(elements.fullscreenBtn, 'click', (e) => {
            e.preventDefault();
            toggleFullscreen();
        });
    }

    // Fullscreen change events
    eventController.add(document, 'fullscreenchange', handleFullscreenChange);
    eventController.add(document, 'webkitfullscreenchange', handleFullscreenChange);

    // NSFW toggle
    if (elements.nsfwToggle) {
        eventController.add(elements.nsfwToggle, 'click', () => {
            toggleNSFW(callbacks.onLoadSubreddit);
        });
    }

    // Autoplay controls
    if (elements.autoplayBtn) {
        eventController.add(elements.autoplayBtn, 'click', toggleAutoplay);
    }

    if (elements.speedSelect) {
        eventController.add(elements.speedSelect, 'change', () => {
            setAutoplaySpeed(parseInt(elements.speedSelect.value, 10));
        });
    }

    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        eventController.add(btn, 'click', () => {
            // Update active state
            document.querySelectorAll('.sort-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');

            // Update state
            store.setState({ sort: btn.dataset.sort });

            // Show/hide time select
            const elements = getElements();
            if (elements.timeSelect) {
                elements.timeSelect.style.display =
                    store.get('sort') === 'top' ? 'inline-block' : 'none';
            }

            // Reload if subreddit is loaded
            if (store.get('subreddit') && callbacks.onLoadSubreddit) {
                callbacks.onLoadSubreddit();
            }
        });
    });

    // Time select
    if (elements.timeSelect) {
        eventController.add(elements.timeSelect, 'change', () => {
            store.setState({ time: elements.timeSelect.value });
            if (store.get('subreddit') && callbacks.onLoadSubreddit) {
                callbacks.onLoadSubreddit();
            }
        });
    }

    // Touch zone clicks
    if (elements.touchLeft) {
        eventController.add(elements.touchLeft, 'click', () => navigate(-1));
    }
    if (elements.touchRight) {
        eventController.add(elements.touchRight, 'click', () => navigate(1));
    }
    if (elements.touchCenter) {
        eventController.add(elements.touchCenter, 'click', toggleUI);
    }

    // Keyboard navigation
    eventController.add(document, 'keydown', handleKeydown);

    // Touch events
    eventController.add(document, 'touchstart', handleTouchStart, { passive: true });
    eventController.add(document, 'touchmove', handleTouchMove, { passive: true });
    eventController.add(document, 'touchend', handleTouchEnd, { passive: true });

    // Mouse events for pan
    if (elements.slideshow) {
        eventController.add(elements.slideshow, 'mousedown', handleMouseDown);
        eventController.add(elements.slideshow, 'dblclick', handleDoubleClick);
    }
    eventController.add(document, 'mousemove', handleMouseMove);
    eventController.add(document, 'mouseup', handleMouseUp);
}

/**
 * Removes all event listeners
 */
export function cleanupEventListeners() {
    eventController.cleanup();
}

/**
 * Gets the count of active event listeners
 *
 * @returns {number} Number of active listeners
 */
export function getEventListenerCount() {
    return eventController.getCount();
}

// Make controls available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.controls = {
        navigate,
        toggleFullscreen,
        toggleZoom,
        resetZoom,
        startAutoplay,
        stopAutoplay,
        toggleAutoplay,
        setAutoplaySpeed,
        toggleNSFW,
        triggerInitialPreload,
        initEventListeners,
        cleanupEventListeners,
        getEventListenerCount
    };
}

export default {
    navigate,
    toggleFullscreen,
    toggleZoom,
    resetZoom,
    startAutoplay,
    stopAutoplay,
    toggleAutoplay,
    setAutoplaySpeed,
    toggleNSFW,
    triggerInitialPreload,
    initEventListeners,
    cleanupEventListeners,
    getEventListenerCount
};
