/**
 * Reddit Viewer - Media Extraction Module
 *
 * Extracts media URLs from Reddit posts and external sources.
 * Handles galleries, videos, images, and external hosts (Imgur, Gfycat, etc.)
 *
 * @module media
 */

import CONFIG from './config.js';
import { decodeHtmlEntities, createRedditUrl, isDirectImageUrl, isRedditImageUrl } from './utils.js';
import { fetchViaWorkerProxy } from './api.js';
import { store } from './state.js';

/**
 * @typedef {Object} ExtractedMedia
 * @property {string} postId - Reddit post ID
 * @property {string} title - Post title
 * @property {string} permalink - Full Reddit URL
 * @property {string} author - Post author
 * @property {string} subreddit - Subreddit name
 * @property {boolean} isNSFW - Whether post is NSFW
 * @property {string} source - Media source (reddit, imgur, gfycat, etc.)
 * @property {string} type - Media type (image, video, gif)
 * @property {string} url - Media URL
 * @property {boolean} [isGallery] - Whether part of a gallery
 * @property {number} [galleryIndex] - Position in gallery (1-based)
 * @property {number} [galleryTotal] - Total gallery items
 */

/**
 * Creates a base media object with common properties
 *
 * @param {Object} post - Reddit post data
 * @returns {Object} Base media object
 * @private
 */
function createBaseMedia(post) {
    return {
        postId: post.id,
        title: post.title,
        permalink: createRedditUrl(post.permalink),
        author: post.author,
        subreddit: post.subreddit,
        isNSFW: post.over_18 || false,
        source: 'reddit'
    };
}

/**
 * Extracts media from gallery posts
 *
 * @param {Object} post - Reddit post data
 * @param {Object} base - Base media object
 * @returns {Array<ExtractedMedia>} Array of media objects
 * @private
 */
function extractGalleryMedia(post, base) {
    const slides = [];

    if (!post.media_metadata) {
        return slides;
    }

    // Get gallery items in order (or fallback to unordered)
    const items = post.gallery_data?.items ||
        Object.keys(post.media_metadata).map(id => ({ media_id: id }));

    const total = items.length;

    items.forEach((item, index) => {
        const media = post.media_metadata[item.media_id];
        if (!media) return;

        // Try to get the best quality image URL
        let url = null;

        if (media.s?.u) {
            url = decodeHtmlEntities(media.s.u);
        } else if (media.s?.gif) {
            url = decodeHtmlEntities(media.s.gif);
        } else if (media.p && media.p.length > 0) {
            // Fallback to highest resolution preview
            url = decodeHtmlEntities(media.p[media.p.length - 1].u);
        }

        if (url) {
            slides.push({
                ...base,
                type: media.e === 'AnimatedImage' ? 'gif' : 'image',
                url,
                isGallery: true,
                galleryIndex: index + 1,
                galleryTotal: total
            });
        }
    });

    return slides;
}

/**
 * Extracts Reddit video media
 *
 * @param {Object} post - Reddit post data
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 * @private
 */
function extractRedditVideo(post, base) {
    const videoUrl = post.media?.reddit_video?.fallback_url;

    if (!videoUrl) {
        return null;
    }

    return {
        ...base,
        type: 'video',
        url: videoUrl
    };
}

/**
 * Extracts preview image/video from post
 *
 * @param {Object} post - Reddit post data
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 * @private
 */
function extractPreviewMedia(post, base) {
    const preview = post.preview?.images?.[0];

    if (!preview) {
        return null;
    }

    // Check for video variant
    if (preview.variants?.mp4?.source?.url) {
        return {
            ...base,
            type: 'video',
            url: decodeHtmlEntities(preview.variants.mp4.source.url)
        };
    }

    // Check for GIF variant
    if (preview.variants?.gif?.source?.url) {
        return {
            ...base,
            type: 'image',
            url: decodeHtmlEntities(preview.variants.gif.source.url)
        };
    }

    // Fallback to static image
    if (preview.source?.url) {
        return {
            ...base,
            type: 'image',
            url: decodeHtmlEntities(preview.source.url)
        };
    }

    return null;
}

/**
 * Extracts media from Imgur URLs
 *
 * @param {string} url - Imgur URL
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 * @private
 */
function extractImgurMedia(url, base) {
    // Check for i.imgur.com direct links first
    if (url.includes('i.imgur.com')) {
        const gifvMatch = url.match(CONFIG.mediaPatterns.IMGUR_DIRECT);
        if (gifvMatch) {
            return {
                ...base,
                type: 'video',
                url: CONFIG.mediaUrls.IMGUR_VIDEO(gifvMatch[1]),
                source: 'imgur'
            };
        }
        return {
            ...base,
            type: 'image',
            url: url.replace('.gifv', '.mp4'),
            source: 'imgur'
        };
    }

    // Check for imgur.com URLs
    const match = url.match(CONFIG.mediaPatterns.IMGUR);
    if (!match) {
        return null;
    }

    const imgurId = match[1];
    const extension = match[2]?.toLowerCase();

    // Albums and galleries - try to get first image
    if (url.includes('/a/') || url.includes('/gallery/')) {
        return {
            ...base,
            type: 'image',
            url: CONFIG.mediaUrls.IMGUR_IMAGE(imgurId),
            source: 'imgur'
        };
    }

    // Video formats
    if (extension === 'gifv' || extension === 'mp4') {
        return {
            ...base,
            type: 'video',
            url: CONFIG.mediaUrls.IMGUR_VIDEO(imgurId),
            source: 'imgur'
        };
    }

    // Default to image
    return {
        ...base,
        type: 'image',
        url: CONFIG.mediaUrls.IMGUR_IMAGE(imgurId),
        source: 'imgur'
    };
}

/**
 * Extracts media from Gfycat URLs
 *
 * @param {string} url - Gfycat URL
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 * @private
 */
function extractGfycatMedia(url, base) {
    const match = url.match(CONFIG.mediaPatterns.GFYCAT);
    if (!match) {
        return null;
    }

    // Remove any suffix after hyphen (e.g., '-size_restricted')
    const gfyId = match[1].split('-')[0];

    return {
        ...base,
        type: 'video',
        url: CONFIG.mediaUrls.GFYCAT_VIDEO(gfyId),
        source: 'gfycat'
    };
}

/**
 * External video API token cache
 * @private
 */
let externalVideoToken = null;
let externalVideoTokenExpiry = 0;

/**
 * Gets a temporary API token for external video provider
 * @returns {Promise<string|null>} Token or null on failure
 * @private
 */
// Encoded API base URL
const _xvb = () => atob('aHR0cHM6Ly9hcGkucmVkZ2lmcy5jb20vdjI=');

async function getExternalVideoToken() {
    if (externalVideoToken && Date.now() < externalVideoTokenExpiry) {
        return externalVideoToken;
    }

    try {
        const authUrl = `${_xvb()}/auth/temporary`;
        let response;

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        if (CONFIG.proxy.ENABLED) {
            response = await fetchViaWorkerProxy(authUrl, { headers });
        } else {
            response = await fetch(authUrl, { headers });
        }

        const data = await response.json();
        if (data.token) {
            externalVideoToken = data.token;
            externalVideoTokenExpiry = Date.now() + (60 * 60 * 1000);
            return externalVideoToken;
        }
    } catch (error) {
        console.warn('Failed to get external video token:', error);
    }
    return null;
}

/**
 * Fetches the actual video URL from external API
 * @param {string} id - Video ID
 * @returns {Promise<string|null>} Video URL or null on failure
 */
export async function fetchExternalVideoUrl(id) {
    console.log('Fetching external video URL for ID:', id);
    const token = await getExternalVideoToken();
    if (!token) {
        console.warn('Failed to get external video token');
        return null;
    }
    console.log('Got token, fetching video info...');

    try {
        const apiUrl = `${_xvb()}/gifs/${id.toLowerCase()}`;
        let response;

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        if (CONFIG.proxy.ENABLED) {
            response = await fetchViaWorkerProxy(apiUrl, { headers });
        } else {
            response = await fetch(apiUrl, { headers });
        }

        const data = await response.json();
        console.log('API response:', JSON.stringify(data).substring(0, 500));
        // Try multiple response paths for compatibility
        const urls = data.gif?.urls || data.urls || {};
        const videoUrl = urls.hd || urls.sd || null;
        console.log('Resolved video URL:', videoUrl);

        // Return proxied URL to bypass hotlink protection
        if (videoUrl && CONFIG.proxy.ENABLED) {
            const proxiedUrl = `${CONFIG.proxy.URL}?url=${encodeURIComponent(videoUrl)}`;
            console.log('Using proxied URL:', proxiedUrl);
            return proxiedUrl;
        }

        return videoUrl;
    } catch (error) {
        console.warn('Failed to fetch external video URL:', error);
        return null;
    }
}

/**
 * Pre-resolves external video URLs for upcoming slides
 * This eliminates the "Loading..." delay when navigating to external videos
 *
 * @param {Array} slides - Array of slide objects
 * @param {number} startIndex - Index to start preloading from
 * @param {number} count - Number of slides to preload
 */
export async function preloadExternalVideoUrls(slides, startIndex, count) {
    const preloadedVideoUrls = store.get('preloadedVideoUrls');
    const preloadingInProgress = store.get('preloadingInProgress');

    for (let i = 0; i < count; i++) {
        const idx = startIndex + i;
        if (idx >= slides.length) break;

        const slide = slides[idx];

        // Only preload external videos that need resolution
        if (!slide.needsResolve || !slide.externalVideoId) continue;

        const videoId = slide.externalVideoId;

        // Skip if already cached or currently preloading
        if (preloadedVideoUrls.has(videoId) || preloadingInProgress.has(videoId)) continue;

        // Mark as in progress
        preloadingInProgress.add(videoId);

        // Resolve URL in background (don't await - let it run async)
        fetchExternalVideoUrl(videoId).then(url => {
            if (url) {
                preloadedVideoUrls.set(videoId, url);
                console.log(`Preloaded external video URL for ${videoId}`);
            }
            preloadingInProgress.delete(videoId);
        }).catch(err => {
            console.warn(`Failed to preload external video URL for ${videoId}:`, err);
            preloadingInProgress.delete(videoId);
        });
    }
}

/**
 * Gets a preloaded video URL if available
 *
 * @param {string} videoId - External video ID
 * @returns {string|null} Cached URL or null
 */
export function getPreloadedVideoUrl(videoId) {
    const preloadedVideoUrls = store.get('preloadedVideoUrls');
    return preloadedVideoUrls.get(videoId) || null;
}

/**
 * Extracts media from external video provider URLs
 *
 * @param {string} url - External URL
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 * @private
 */
function extractExternalVideoMedia(url, base) {
    console.log('Checking external video URL:', url);
    const match = url.match(CONFIG.mediaPatterns.EXTERNAL_VIDEO);
    if (!match) {
        console.log('No match for external video pattern');
        return null;
    }

    const videoId = match[1].toLowerCase();
    console.log('Extracted video ID:', videoId);

    return {
        ...base,
        type: 'video',
        url: null,
        externalVideoId: videoId,
        source: 'external',
        needsResolve: true
    };
}

/**
 * Extracts media from Giphy URLs
 *
 * @param {string} url - Giphy URL
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 * @private
 */
function extractGiphyMedia(url, base) {
    // Direct Giphy URLs
    if (url.includes('i.giphy.com') || url.includes('media.giphy.com')) {
        return {
            ...base,
            type: 'image',
            url,
            source: 'giphy'
        };
    }

    // Giphy page URLs
    const match = url.match(CONFIG.mediaPatterns.GIPHY);
    if (!match) {
        return null;
    }

    const giphyId = match[1];

    return {
        ...base,
        type: 'image',
        url: CONFIG.mediaUrls.GIPHY_GIF(giphyId),
        source: 'giphy'
    };
}

/**
 * Extracts media from external sources (Imgur, Gfycat, Giphy, etc.)
 *
 * @param {string} url - External URL
 * @param {Object} base - Base media object
 * @returns {ExtractedMedia|null} Media object or null
 */
export function extractExternalMedia(url, base) {
    if (!url) return null;

    // Try each external source
    if (url.includes('imgur.com') || url.includes('i.imgur.com')) {
        return extractImgurMedia(url, base);
    }

    if (url.includes('gfycat.com')) {
        return extractGfycatMedia(url, base);
    }

    // Check for external video provider (multiple domain formats)
    const extDomain = atob('cmVkZ2lmcy5jb20=');
    if (url.includes(extDomain)) {
        console.log('Found external video domain in URL:', url);
        return extractExternalVideoMedia(url, base);
    }

    if (url.includes('giphy.com') || url.includes('i.giphy.com') || url.includes('media.giphy.com')) {
        return extractGiphyMedia(url, base);
    }

    return null;
}

/**
 * Extracts all media from a Reddit post
 *
 * This function processes a post in priority order:
 * 1. Gallery posts (media_metadata)
 * 2. Reddit videos (is_video)
 * 3. Direct image links
 * 4. i.redd.it images
 * 5. External media (Imgur, Gfycat, etc.)
 * 6. Preview images (fallback)
 *
 * @param {Object} post - Reddit post data
 * @param {Object} [options={}] - Extraction options
 * @param {boolean} [options.showNSFW=false] - Whether to include NSFW content
 * @returns {Array<ExtractedMedia>} Array of extracted media objects
 *
 * @example
 * const media = extractMedia(post, { showNSFW: false });
 * // Returns: [{ type: 'image', url: '...', ... }]
 */
export function extractMedia(post, options = {}) {
    const { showNSFW = false } = options;
    const slides = [];

    // Filter NSFW content
    if (post.over_18 && !showNSFW) {
        return slides;
    }

    const base = createBaseMedia(post);

    // 1. Gallery posts
    if (post.is_gallery && post.media_metadata) {
        const galleryMedia = extractGalleryMedia(post, base);
        if (galleryMedia.length > 0) {
            return galleryMedia;
        }
    }

    // 2. Reddit video
    if (post.is_video) {
        const videoMedia = extractRedditVideo(post, base);
        if (videoMedia) {
            slides.push(videoMedia);
            return slides;
        }
    }

    // 3. Direct image link
    if (post.url && isDirectImageUrl(post.url)) {
        slides.push({ ...base, type: 'image', url: post.url });
        return slides;
    }

    // 4. i.redd.it images
    if (post.url && isRedditImageUrl(post.url)) {
        slides.push({ ...base, type: 'image', url: post.url });
        return slides;
    }

    // 5. External media
    const externalMedia = extractExternalMedia(post.url, base);
    if (externalMedia) {
        slides.push(externalMedia);
        return slides;
    }

    // 6. Preview images as fallback
    const previewMedia = extractPreviewMedia(post, base);
    if (previewMedia) {
        slides.push(previewMedia);
        return slides;
    }

    return slides;
}

/**
 * Extracts media from multiple posts
 *
 * @param {Array<Object>} posts - Array of Reddit posts
 * @param {Object} [options={}] - Extraction options
 * @returns {Array<ExtractedMedia>} Array of all extracted media
 *
 * @example
 * const allMedia = extractMediaFromPosts(posts, { showNSFW: false });
 */
export function extractMediaFromPosts(posts, options = {}) {
    const allMedia = [];

    for (const post of posts) {
        const media = extractMedia(post, options);
        allMedia.push(...media);
    }

    return allMedia;
}

/**
 * Preloads an image by creating an Image object
 *
 * @param {string} url - Image URL to preload
 * @returns {Promise<HTMLImageElement>} Promise that resolves with the image
 */
export function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * Preloads multiple images
 *
 * @param {Array<string>} urls - Array of image URLs
 * @returns {Promise<Array<HTMLImageElement>>} Promise that resolves with array of images
 */
export function preloadImages(urls) {
    return Promise.allSettled(urls.map(preloadImage));
}

/**
 * Gets the media type from a URL
 *
 * @param {string} url - Media URL
 * @returns {string} Media type (image, video, or unknown)
 */
export function getMediaType(url) {
    if (!url) return 'unknown';

    const videoExtensions = ['.mp4', '.webm', '.mov'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    const lowerUrl = url.toLowerCase();

    if (videoExtensions.some(ext => lowerUrl.includes(ext))) {
        return 'video';
    }

    if (imageExtensions.some(ext => lowerUrl.includes(ext))) {
        return 'image';
    }

    return 'unknown';
}

// Make media functions available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.media = {
        extractMedia,
        extractMediaFromPosts,
        extractExternalMedia,
        fetchExternalVideoUrl,
        preloadExternalVideoUrls,
        getPreloadedVideoUrl,
        preloadImage,
        preloadImages,
        getMediaType
    };
}

export default {
    extractMedia,
    extractMediaFromPosts,
    extractExternalMedia,
    fetchExternalVideoUrl,
    preloadExternalVideoUrls,
    getPreloadedVideoUrl,
    preloadImage,
    preloadImages,
    getMediaType
};
