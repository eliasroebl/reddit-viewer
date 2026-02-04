/**
 * Reddit Viewer - API Module
 *
 * Handles all communication with the Reddit API using JSONP.
 * Includes retry logic with exponential backoff for reliability.
 *
 * @module api
 */

import CONFIG from './config.js';
import { generateCallbackName, sleep } from './utils.js';

/**
 * @typedef {Object} RedditResponse
 * @property {Object} data - Response data container
 * @property {Array<Object>} data.children - Array of post wrappers
 * @property {string|null} data.after - Pagination token
 */

/**
 * @typedef {Object} RedditPost
 * @property {string} id - Post ID
 * @property {string} title - Post title
 * @property {string} permalink - Post permalink
 * @property {string} author - Post author username
 * @property {string} subreddit - Subreddit name
 * @property {boolean} over_18 - Whether post is NSFW
 * @property {boolean} is_video - Whether post is a video
 * @property {boolean} is_gallery - Whether post is a gallery
 * @property {string} url - Post URL
 * @property {Object} [media] - Media metadata
 * @property {Object} [media_metadata] - Gallery media metadata
 * @property {Object} [gallery_data] - Gallery data
 * @property {Object} [preview] - Preview images
 */

/**
 * Fallback CORS proxies (used when custom proxy is not configured)
 */
const CORS_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
];

/**
 * Makes a fetch request via the configured Cloudflare Worker proxy
 *
 * @param {string} url - URL to request
 * @param {Object} [options={}] - Fetch options
 * @param {Object} [options.headers] - Additional headers to pass through
 * @returns {Promise<Response>} Fetch response
 */
export async function fetchViaWorkerProxy(url, options = {}) {
    const proxyUrl = `${CONFIG.proxy.URL}?url=${encodeURIComponent(url)}`;
    const fetchOptions = {};

    if (options.headers) {
        fetchOptions.headers = options.headers;
    }

    const response = await fetch(proxyUrl, fetchOptions);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response;
}

/**
 * Makes a fetch request via CORS proxy
 * Uses Cloudflare Worker proxy if configured, otherwise falls back to public proxies
 *
 * @param {string} url - URL to request
 * @returns {Promise<Object>} Response data
 * @throws {Error} On timeout or network error
 */
async function fetchViaProxy(url) {
    // Use custom Cloudflare Worker proxy if configured
    if (CONFIG.proxy.ENABLED) {
        const response = await fetchViaWorkerProxy(url);
        return response.json();
    }

    // Fallback to public CORS proxies
    let lastError;

    for (const makeProxyUrl of CORS_PROXIES) {
        try {
            const proxyUrl = makeProxyUrl(url);
            console.log('Trying proxy:', proxyUrl);
            const response = await fetch(proxyUrl);
            if (response.ok) {
                return response.json();
            }
        } catch (e) {
            lastError = e;
        }
    }

    throw lastError || new Error('All proxies failed');
}

/**
 * Track if JSONP works (skip it if it failed before)
 */
let jsonpWorks = true;

/**
 * Makes a JSONP request to bypass CORS restrictions
 * Falls back to CORS proxy if JSONP fails (e.g., on mobile)
 *
 * @param {string} url - URL to request (without callback parameter)
 * @returns {Promise<Object>} Response data
 * @throws {Error} On timeout or network error
 *
 * @example
 * const data = await jsonp('https://www.reddit.com/r/pics.json');
 */
export async function jsonp(url) {
    // Skip JSONP if it failed before (use proxy directly)
    if (!jsonpWorks) {
        return fetchViaProxy(url);
    }

    // Try JSONP first
    try {
        return await jsonpDirect(url);
    } catch (e) {
        console.log('JSONP failed, using CORS proxy for all future requests...');
        jsonpWorks = false;
        return fetchViaProxy(url);
    }
}

/**
 * Direct JSONP implementation
 */
function jsonpDirect(url) {
    return new Promise((resolve, reject) => {
        const callbackName = generateCallbackName();
        const script = document.createElement('script');
        let timeoutId;

        function cleanup() {
            clearTimeout(timeoutId);
            delete window[callbackName];
            if (script.parentNode) {
                script.remove();
            }
        }

        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Request timeout'));
        }, CONFIG.api.REQUEST_TIMEOUT);

        window[callbackName] = (data) => {
            cleanup();
            resolve(data);
        };

        script.onerror = () => {
            cleanup();
            reject(new Error('Failed to load'));
        };

        const separator = url.includes('?') ? '&' : '?';
        const finalUrl = `${url}${separator}jsonp=${callbackName}`;

        console.log('JSONP request:', finalUrl);
        script.src = finalUrl;

        document.head.appendChild(script);
    });
}

/**
 * Fetches data with retry logic using exponential backoff
 *
 * @param {string} url - URL to fetch
 * @param {number} [retries] - Number of retry attempts
 * @returns {Promise<Object>} Response data
 * @throws {Error} After all retries exhausted
 *
 * @example
 * const data = await fetchWithRetry('https://www.reddit.com/r/pics.json');
 */
export async function fetchWithRetry(url, retries = CONFIG.api.RETRY_ATTEMPTS) {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await jsonp(url);
        } catch (error) {
            lastError = error;

            // Don't wait after the last attempt
            if (attempt < retries - 1) {
                const delay = CONFIG.api.RETRY_BASE_DELAY * Math.pow(2, attempt);
                console.warn(`Request failed, retrying in ${delay}ms...`, error);
                await sleep(delay);
            }
        }
    }

    throw lastError;
}

/**
 * Builds the Reddit API URL for fetching posts
 *
 * @param {Object} options - URL options
 * @param {string} options.subreddit - Subreddit name (supports multi like 'pics+earthporn')
 * @param {string} [options.sort='hot'] - Sort method (hot, new, top)
 * @param {string} [options.time='all'] - Time filter for top sort (hour, day, week, month, year, all)
 * @param {string} [options.after] - Pagination token
 * @param {number} [options.limit] - Number of posts to fetch
 * @returns {string} Complete API URL
 *
 * @example
 * buildRedditUrl({ subreddit: 'pics', sort: 'top', time: 'week' })
 * // Returns: 'https://www.reddit.com/r/pics/top.json?limit=100&raw_json=1&t=week'
 */
export function buildRedditUrl(options) {
    const {
        subreddit,
        sort = CONFIG.defaults.SORT,
        time = CONFIG.defaults.TIME,
        after = null,
        limit = CONFIG.api.POSTS_PER_PAGE
    } = options;

    let url = `${CONFIG.api.BASE_URL}/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;

    if (sort === 'top') {
        url += `&t=${time}`;
    }

    if (after) {
        url += `&after=${after}`;
    }

    return url;
}

/**
 * Fetches posts from a subreddit
 *
 * @param {Object} options - Fetch options
 * @param {string} options.subreddit - Subreddit name
 * @param {string} [options.sort='hot'] - Sort method
 * @param {string} [options.time='all'] - Time filter
 * @param {string} [options.after] - Pagination token for loading more
 * @returns {Promise<{posts: Array<RedditPost>, after: string|null}>} Posts and pagination token
 * @throws {Error} If subreddit not found or request fails
 *
 * @example
 * const { posts, after } = await fetchPosts({ subreddit: 'pics', sort: 'hot' });
 */
export async function fetchPosts(options) {
    const url = buildRedditUrl(options);
    const data = await fetchWithRetry(url);

    if (!data?.data) {
        throw new Error('Subreddit not found');
    }

    const posts = data.data.children.map(child => child.data);
    const after = data.data.after;

    return { posts, after };
}

/**
 * Validates a subreddit name format
 *
 * @param {string} subreddit - Subreddit name to validate
 * @returns {boolean} True if valid format
 *
 * @example
 * isValidSubreddit('pics') // true
 * isValidSubreddit('pics+earthporn') // true
 * isValidSubreddit('') // false
 */
export function isValidSubreddit(subreddit) {
    if (!subreddit || typeof subreddit !== 'string') {
        return false;
    }

    // Allow alphanumeric, underscores, and plus signs (for multi)
    const pattern = /^[a-zA-Z0-9_]+(\+[a-zA-Z0-9_]+)*$/;
    return pattern.test(subreddit);
}

/**
 * Checks if a URL is a valid Reddit media URL
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if valid Reddit media URL
 */
export function isRedditMediaUrl(url) {
    if (!url) return false;

    const validDomains = [
        'i.redd.it',
        'v.redd.it',
        'preview.redd.it',
        'external-preview.redd.it'
    ];

    try {
        const urlObj = new URL(url);
        return validDomains.some(domain => urlObj.hostname === domain);
    } catch {
        return false;
    }
}

// Make API functions available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.api = {
        jsonp,
        fetchWithRetry,
        fetchViaWorkerProxy,
        buildRedditUrl,
        fetchPosts,
        isValidSubreddit,
        isRedditMediaUrl
    };
}

export default {
    jsonp,
    fetchWithRetry,
    fetchViaWorkerProxy,
    buildRedditUrl,
    fetchPosts,
    isValidSubreddit,
    isRedditMediaUrl
};
