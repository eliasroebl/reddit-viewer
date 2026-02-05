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
import { fetchExternalVideoUrl, getPreloadedVideoUrl } from './media.js';

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
 * Gets the buffer health of a video element
 * Returns seconds of video buffered ahead of current playback position
 *
 * @param {HTMLVideoElement} video - Video element to check
 * @returns {number} Seconds of buffer ahead (0 if no buffer)
 */
export function getBufferHealth(video) {
    if (!video || video.buffered.length === 0) return 0;

    // Find the buffer range that contains the current time
    for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
            return video.buffered.end(i) - video.currentTime;
        }
    }

    // If current time is not in any buffer range, return 0
    return 0;
}

/**
 * Pauses all preloaded video elements to free bandwidth
 */
export function pauseAllPreloads() {
    if (store.get('preloadingPaused')) return; // Already paused

    const preloadedVideos = store.get('preloadedVideos');
    for (const [slideIndex, cached] of preloadedVideos.entries()) {
        if (cached.element && !cached.element.paused) {
            cached.element.pause();
        }
    }
    store.setState({ preloadingPaused: true });
    console.log('Preloading paused - current video needs bandwidth');
}

/**
 * Resumes preloading for upcoming videos
 */
export function resumePreloads() {
    if (!store.get('preloadingPaused')) return; // Already running

    store.setState({ preloadingPaused: false });
    console.log('Preloading resumed - buffer is healthy');

    // Resume loading the next video (don't aggressively load all)
    const currentIndex = store.get('currentIndex');
    const preloadedVideos = store.get('preloadedVideos');
    const nextVideoCache = preloadedVideos.get(currentIndex + 1);

    if (nextVideoCache && nextVideoCache.element) {
        // Trigger loading by playing then immediately pausing
        nextVideoCache.element.play().then(() => {
            nextVideoCache.element.pause();
        }).catch(() => {});
    }
}

/** Buffer monitoring interval ID */
let bufferMonitorInterval = null;

/**
 * Starts monitoring the current video's buffer health
 * Pauses preloading when buffer is low, resumes when healthy
 */
export function startBufferMonitoring() {
    // Clear any existing monitor
    stopBufferMonitoring();

    const checkBuffer = () => {
        const video = getActiveVideo();
        if (!video) return;

        const bufferHealth = getBufferHealth(video);
        const minBuffer = CONFIG.preloading.MIN_BUFFER_SECONDS;
        const healthyBuffer = CONFIG.preloading.HEALTHY_BUFFER_SECONDS;

        if (bufferHealth < minBuffer && !store.get('preloadingPaused')) {
            pauseAllPreloads();
        } else if (bufferHealth > healthyBuffer && store.get('preloadingPaused')) {
            resumePreloads();
        }
    };

    // Check immediately
    checkBuffer();

    // Then check periodically
    bufferMonitorInterval = setInterval(checkBuffer, CONFIG.preloading.BUFFER_CHECK_INTERVAL);
}

/**
 * Stops buffer health monitoring
 */
export function stopBufferMonitoring() {
    if (bufferMonitorInterval) {
        clearInterval(bufferMonitorInterval);
        bufferMonitorInterval = null;
    }
}

/**
 * Preloads a video element for a given slide
 * Uses metadata preload initially, only buffers when current video is healthy
 *
 * @param {Object} slideData - Slide data object
 * @param {number} slideIndex - Index of the slide
 * @param {string} videoUrl - Resolved video URL
 */
export function preloadVideoElement(slideData, slideIndex, videoUrl) {
    const preloadedVideos = store.get('preloadedVideos');

    // Skip if already preloaded or at max capacity
    if (preloadedVideos.has(slideIndex)) return;
    if (preloadedVideos.size >= CONFIG.preloading.MAX_CACHED_VIDEOS) return;

    // Skip if preloading is paused (current video needs bandwidth)
    if (store.get('preloadingPaused')) {
        console.log(`Skipping preload for slide ${slideIndex} - preloading paused`);
        return;
    }

    const video = document.createElement('video');
    video.src = videoUrl;
    // Use 'metadata' instead of 'auto' to be less aggressive
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.crossOrigin = 'anonymous';

    // Position off-screen to trigger loading without display
    video.style.position = 'absolute';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';

    // Track when video is ready
    video.addEventListener('canplaythrough', () => {
        console.log(`Video preloaded for slide ${slideIndex}`);
    }, { once: true });

    video.addEventListener('error', () => {
        console.warn(`Failed to preload video for slide ${slideIndex}`);
        preloadedVideos.delete(slideIndex);
        video.remove();
    }, { once: true });

    // Add to DOM to trigger loading
    document.body.appendChild(video);

    // Store in cache
    preloadedVideos.set(slideIndex, {
        element: video,
        url: videoUrl,
        timestamp: Date.now()
    });

    console.log(`Started preloading video for slide ${slideIndex}`);

    // Only start buffering the NEXT video (priority), not all preloaded videos
    const currentIndex = store.get('currentIndex');
    if (slideIndex === currentIndex + 1) {
        // Trigger loading by playing then immediately pausing
        video.play().then(() => {
            video.pause();
        }).catch(() => {});
    }
}

/**
 * Gets a preloaded video element if available
 *
 * @param {number} slideIndex - Index of the slide
 * @returns {HTMLVideoElement|null} Preloaded video element or null
 */
export function getPreloadedVideo(slideIndex) {
    const preloadedVideos = store.get('preloadedVideos');
    const cached = preloadedVideos.get(slideIndex);

    if (cached) {
        // Remove from cache (it will be used)
        preloadedVideos.delete(slideIndex);

        // Remove from off-screen position
        const video = cached.element;
        video.style.position = '';
        video.style.left = '';
        video.style.width = '';
        video.style.height = '';

        return video;
    }

    return null;
}

/**
 * Cleans up preloaded videos that are too far behind current position
 *
 * @param {number} currentIndex - Current slide index
 */
export function cleanupOldPreloads(currentIndex) {
    const preloadedVideos = store.get('preloadedVideos');
    const threshold = CONFIG.preloading.CLEANUP_THRESHOLD;

    for (const [slideIndex, cached] of preloadedVideos.entries()) {
        // Remove videos that are too far behind
        if (slideIndex < currentIndex - threshold) {
            cached.element.src = '';
            cached.element.remove();
            preloadedVideos.delete(slideIndex);
            console.log(`Cleaned up preloaded video for slide ${slideIndex}`);
        }
    }
}

/**
 * Preloads video elements for upcoming slides
 *
 * @param {Array} slides - Array of slide objects
 * @param {number} currentIndex - Current slide index
 */
export async function preloadUpcomingVideos(slides, currentIndex) {
    const preloadedVideoUrls = store.get('preloadedVideoUrls');
    const count = CONFIG.preloading.VIDEO_PRELOAD_COUNT;

    for (let i = 1; i <= count; i++) {
        const idx = currentIndex + i;
        if (idx >= slides.length) break;

        const slide = slides[idx];
        if (slide.type !== 'video') continue;

        let videoUrl = slide.url;

        // For external videos, check if URL is resolved
        if (slide.needsResolve && slide.externalVideoId) {
            const cachedUrl = preloadedVideoUrls.get(slide.externalVideoId);
            if (cachedUrl) {
                videoUrl = cachedUrl;
            } else {
                // URL not resolved yet, skip for now
                continue;
            }
        }

        if (videoUrl) {
            preloadVideoElement(slide, idx, videoUrl);
        }
    }
}

/** Timer for auto-hiding video controls */
let controlsHideTimer = null;

/**
 * Creates a video controls overlay with mute button
 *
 * @param {HTMLVideoElement} video - Video element to control
 * @returns {HTMLElement} Controls overlay element
 * @private
 */
function createVideoControlsOverlay(video) {
    const overlay = document.createElement('div');
    overlay.className = 'video-controls-overlay';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'video-mute-btn';
    muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    muteBtn.innerHTML = video.muted ? '🔇' : '🔊';

    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        muteBtn.innerHTML = video.muted ? '🔇' : '🔊';
        muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
        // Persist mute state
        store.setState({ videoMuted: video.muted });
        // Reset auto-hide timer
        showVideoControls(overlay);
    });

    // Update button when mute state changes externally
    video.addEventListener('volumechange', () => {
        muteBtn.innerHTML = video.muted ? '🔇' : '🔊';
        muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    });

    overlay.appendChild(muteBtn);
    return overlay;
}

/**
 * Shows video controls and sets up auto-hide timer
 *
 * @param {HTMLElement} overlay - Controls overlay element
 */
function showVideoControls(overlay) {
    overlay.classList.add('visible');

    // Clear any existing timer
    if (controlsHideTimer) {
        clearTimeout(controlsHideTimer);
    }

    // Auto-hide after 3 seconds
    controlsHideTimer = setTimeout(() => {
        overlay.classList.remove('visible');
    }, 3000);
}

/**
 * Sets up tap-to-show controls behavior for a video slide
 *
 * @param {HTMLElement} slide - Slide element
 * @param {HTMLElement} overlay - Controls overlay element
 */
function setupVideoTapHandler(slide, overlay) {
    slide.addEventListener('click', (e) => {
        // Don't trigger on button clicks
        if (e.target.closest('.video-mute-btn')) return;

        // Toggle controls visibility on tap
        if (overlay.classList.contains('visible')) {
            overlay.classList.remove('visible');
            if (controlsHideTimer) {
                clearTimeout(controlsHideTimer);
            }
        } else {
            showVideoControls(overlay);
        }
    });
}

/**
 * Creates a slide element for the slideshow
 *
 * @param {Object} data - Slide data
 * @param {string} position - Slide position (prev, active, next)
 * @param {number} slideIndex - Index of this slide in the slides array
 * @returns {HTMLElement} Slide element
 * @private
 */
function createSlideElement(data, position, slideIndex) {
    const slide = document.createElement('div');
    slide.className = `slide ${position}`;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-label', `Slide: ${data.title}`);

    if (data.type === 'video') {
        // Check for preloaded video element first
        const preloadedVideo = getPreloadedVideo(slideIndex);
        // Get user's mute preference
        const videoMuted = store.get('videoMuted');

        if (preloadedVideo) {
            // Use the preloaded video (already buffered!)
            console.log(`Using preloaded video for slide ${slideIndex}`);
            preloadedVideo.setAttribute('aria-label', data.title);
            // Apply user's mute preference
            preloadedVideo.muted = videoMuted;

            // Add video controls overlay
            const overlay = createVideoControlsOverlay(preloadedVideo);
            slide.appendChild(preloadedVideo);
            slide.appendChild(overlay);
            setupVideoTapHandler(slide, overlay);

            if (position === 'active') {
                preloadedVideo.autoplay = true;
                preloadedVideo.play().catch(() => {});
                // Show controls briefly on active video
                showVideoControls(overlay);
            }

            return slide;
        } else {
            // Create new video element
            const video = document.createElement('video');
            video.loop = true;
            video.playsInline = true;
            video.muted = videoMuted; // Apply user's mute preference
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
                // Check if URL was preloaded
                const preloadedUrl = getPreloadedVideoUrl(data.externalVideoId);

                if (preloadedUrl) {
                    // URL already resolved - use it immediately!
                    console.log(`Using preloaded URL for ${data.externalVideoId}`);
                    video.src = preloadedUrl;
                    data.url = preloadedUrl;
                    data.needsResolve = false;
                } else {
                    // Need to resolve URL
                    const preloadingInProgress = store.get('preloadingInProgress');

                    // Mark as in-progress to prevent duplicate fetches from preloader
                    preloadingInProgress.add(data.externalVideoId);

                    video.poster = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" x="50" text-anchor="middle" fill="white" font-size="12">Loading...</text></svg>';
                    fetchExternalVideoUrl(data.externalVideoId).then(url => {
                        // Remove from in-progress
                        preloadingInProgress.delete(data.externalVideoId);

                        if (url) {
                            // Cache the URL for future use
                            store.get('preloadedVideoUrls').set(data.externalVideoId, url);

                            console.log('Setting video src:', url);
                            video.src = url;
                            // Update slide data for future use
                            data.url = url;
                            data.needsResolve = false;
                            // Play if this is the active video
                            if (position === 'active') {
                                video.play().catch(() => {});
                                showVideoControls(overlay);
                            }
                        } else {
                            video.poster = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" x="50" text-anchor="middle" fill="gray" font-size="8">Video unavailable</text></svg>';
                        }
                    });
                }
            } else {
                video.src = data.url;
            }

            // Add video controls overlay
            const overlay = createVideoControlsOverlay(video);
            slide.appendChild(video);
            slide.appendChild(overlay);
            setupVideoTapHandler(slide, overlay);

            // Explicitly call play() for active videos - but only if src is already set
            // (External videos with needsResolve handle play() in their async callback)
            if (position === 'active' && video.src) {
                video.play().catch(() => {});
                // Show controls briefly on active video
                showVideoControls(overlay);
            }
        }
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
        const slide = createSlideElement(data, positions[i], idx);
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
        getBufferHealth,
        pauseAllPreloads,
        resumePreloads,
        startBufferMonitoring,
        stopBufferMonitoring,
        preloadVideoElement,
        getPreloadedVideo,
        cleanupOldPreloads,
        preloadUpcomingVideos,
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
    getBufferHealth,
    pauseAllPreloads,
    resumePreloads,
    startBufferMonitoring,
    stopBufferMonitoring,
    preloadVideoElement,
    getPreloadedVideo,
    cleanupOldPreloads,
    preloadUpcomingVideos,
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
