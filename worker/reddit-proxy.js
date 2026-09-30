/**
 * Cloudflare Worker - Reddit Viewer Proxy (Service Worker format)
 *
 * Proxies requests to Reddit, external video APIs, and Instagram to bypass CORS.
 *
 * Supported query params:
 *   ?url=<encoded>                        – generic passthrough for whitelisted hosts
 *                                           (reddit.com URLs are routed through the Reddit handler)
 *   ?ig=<username>                        – Instagram profile: resolves user_id then returns first feed page
 *   ?ig_feed=<user_id>&max_id=<cursor>    – Instagram feed pagination
 *
 * Optional secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
 *   REDDIT_CLIENT_ID      – Reddit OAuth app client id. Since mid-2026 Reddit answers every
 *                           unauthenticated *.json request with 403, so without this the
 *                           Worker can only fall back to the (lower-fidelity) RSS feeds.
 *   REDDIT_CLIENT_SECRET  – Secret of a "web"/"script" app (omit for "installed" apps).
 *   IG_SESSIONID          – `sessionid` cookie of a logged-in Instagram account. Instagram now
 *                           requires a login for its profile/feed API from datacenter IPs;
 *                           without it the Worker falls back to parsing the public profile HTML.
 */

addEventListener('fetch', event => {
    event.respondWith(handleRequestSafe(event.request));
});

// Encoded external domains
const _xva = () => atob('YXBpLnJlZGdpZnMuY29t');
const _xvm = () => atob('bWVkaWEucmVkZ2lmcy5jb20=');
const _xvr = () => atob('aHR0cHM6Ly93d3cucmVkZ2lmcy5jb20v');
const _xvo = () => atob('aHR0cHM6Ly93d3cucmVkZ2lmcy5jb20=');

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Reddit config
const REDDIT_HOSTS = ['old.reddit.com', 'www.reddit.com', 'reddit.com'];
const REDDIT_USER_AGENT = 'web:reddit-viewer:v2.0 (media slideshow viewer)';
const REDDIT_SORTS = ['hot', 'new', 'top', 'rising', 'controversial'];
// Cloudflare limits subrequests per invocation (50 on the free plan)
const MAX_VREDDIT_RESOLVES = 40;

// Instagram config
const IG_APP_ID = '936619743392459';
const IG_HOST = 'www.instagram.com';
// iOS app API (used with a session only; same approach as instaloader)
const IG_IOS_APP_ID = '124024574287414';
const IG_IOS_HOST = 'i.instagram.com';
const IG_IOS_USER_AGENT = 'Instagram 361.0.0.35.82 (iPhone14,5; iOS 17_6_1; en_US; en; scale=3.00; 1170x2532; 674117118)';

const IG_USERNAME_RE = /^[a-zA-Z0-9_.]{1,30}$/;
const IG_USER_ID_RE = /^\d{1,20}$/;
// Instagram pagination cursors vary in format (numeric, base64, base64url); allow any printable ASCII
const IG_MAX_ID_RE = /^[\x21-\x7e]{1,500}$/;

// Hosts allowed for generic ?url= passthrough
const ALLOWED_HOSTS = [...REDDIT_HOSTS, _xva(), _xvm(), 'i.instagram.com'];

// Host suffixes allowed for media proxying (CDN domains have dynamic subdomains)
const ALLOWED_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net'];

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Reddit-Source'
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders }
    });
}

/** Reads a Worker secret/variable (exposed as globals in Service Worker format) */
function env(name) {
    const value = globalThis[name];
    return typeof value === 'string' ? value.trim() : '';
}

function isHostAllowed(host) {
    if (ALLOWED_HOSTS.includes(host)) return true;
    return ALLOWED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function decodeXmlEntities(str) {
    return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

let redditToken = null;
let redditTokenExpiry = 0;

/**
 * Gets an application-only OAuth token (cached per isolate).
 * Uses client_credentials for confidential apps and installed_client otherwise.
 */
async function getRedditToken(forceRefresh = false) {
    if (!forceRefresh && redditToken && Date.now() < redditTokenExpiry) {
        return redditToken;
    }

    const clientId = env('REDDIT_CLIENT_ID');
    const clientSecret = env('REDDIT_CLIENT_SECRET');

    const body = new URLSearchParams();
    if (clientSecret) {
        body.set('grant_type', 'client_credentials');
    } else {
        body.set('grant_type', 'https://oauth.reddit.com/grants/installed_client');
        body.set('device_id', 'DO_NOT_TRACK_THIS_DEVICE');
    }

    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': REDDIT_USER_AGENT
        },
        body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(`Reddit token request failed (HTTP ${res.status}${data.error ? `, ${data.error}` : ''})`);
    }

    redditToken = data.access_token;
    redditTokenExpiry = Date.now() + Math.max((data.expires_in || 3600) - 60, 60) * 1000;
    return redditToken;
}

async function fetchRedditOAuth(path, query) {
    const apiUrl = `https://oauth.reddit.com${path}${query.toString() ? `?${query}` : ''}`;
    const doFetch = token => fetch(apiUrl, {
        headers: {
            'Authorization': `bearer ${token}`,
            'User-Agent': REDDIT_USER_AGENT,
            'Accept': 'application/json'
        }
    });

    let res = await doFetch(await getRedditToken());
    if (res.status === 401) {
        res = await doFetch(await getRedditToken(true));
    }
    return res;
}

/**
 * Maps a preview.redd.it thumbnail to the full-size i.redd.it original.
 * preview.redd.it URLs are signed, but i.redd.it serves the same file unsigned.
 */
function fullSizeRedditImage(thumbUrl) {
    try {
        const u = new URL(thumbUrl);
        if (u.hostname === 'preview.redd.it' && /^\/[\w-]+\.(jpe?g|png|gif|webp)$/i.test(u.pathname)) {
            return `https://i.redd.it${u.pathname}`;
        }
    } catch (e) { /* ignore */ }
    return thumbUrl;
}

/**
 * Converts a Reddit Atom (RSS) feed into the shape of a JSON listing so the
 * client's media extraction keeps working unchanged.
 */
function parseRedditAtom(xml) {
    const posts = [];
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

    for (const entry of entries) {
        const pick = re => (entry.match(re) || [])[1] || '';

        const name = pick(/<id>(t3_\w+)<\/id>/);
        if (!name) continue;

        const title = decodeXmlEntities(pick(/<title>([\s\S]*?)<\/title>/));
        const author = decodeXmlEntities(pick(/<name>([\s\S]*?)<\/name>/)).replace(/^\/u\//, '');
        const subreddit = pick(/<category[^>]*\bterm="([^"]+)"/);
        const link = decodeXmlEntities(pick(/<link[^>]*\bhref="([^"]+)"/));
        const content = decodeXmlEntities(pick(/<content[^>]*>([\s\S]*?)<\/content>/));

        const linkUrl = decodeXmlEntities((content.match(/<a href="([^"]+)">\s*\[link\]\s*<\/a>/) || [])[1] || '');
        const thumb = decodeXmlEntities(
            pick(/<media:thumbnail[^>]*\burl="([^"]+)"/) ||
            (content.match(/<img src="([^"]+)"/) || [])[1] || ''
        );

        let permalink = '';
        try { permalink = new URL(link).pathname; } catch (e) { /* ignore */ }

        const post = {
            id: name.slice(3),
            name,
            title,
            author,
            subreddit,
            permalink,
            url: linkUrl || link,
            // RSS carries no NSFW flag
            over_18: false,
            is_video: false,
            is_gallery: false
        };

        let linkHost = '';
        try { linkHost = new URL(post.url).hostname; } catch (e) { /* ignore */ }

        if (linkHost === 'v.redd.it') {
            post.is_video = true;
            post._vreddit = post.url.replace(/\/+$/, '');
        }

        if (thumb) {
            post.preview = { images: [{ source: { url: fullSizeRedditImage(thumb) } }] };
        }

        posts.push(post);
    }

    return posts;
}

/** Picks the highest-resolution video stream from a v.redd.it DASH manifest */
async function resolveVRedditUrl(baseUrl) {
    try {
        const res = await fetch(`${baseUrl}/DASHPlaylist.mpd`, {
            headers: { 'User-Agent': BROWSER_USER_AGENT }
        });
        if (res.ok) {
            const mpd = await res.text();
            const streams = [...mpd.matchAll(/<BaseURL>\s*(DASH_(\d+)(?:\.mp4)?)\s*<\/BaseURL>/g)]
                .map(m => ({ file: m[1], height: Number(m[2]) }))
                .filter(s => s.height <= 1080)
                .sort((a, b) => b.height - a.height);
            if (streams.length > 0) {
                return `${baseUrl}/${streams[0].file}`;
            }
        }
    } catch (e) { /* fall through */ }
    return `${baseUrl}/DASH_360.mp4`;
}

async function resolveRedditVideos(posts) {
    const videoPosts = posts.filter(p => p._vreddit);
    await Promise.all(videoPosts.map(async (post, i) => {
        const fallbackUrl = i < MAX_VREDDIT_RESOLVES
            ? await resolveVRedditUrl(post._vreddit)
            : `${post._vreddit}/DASH_360.mp4`;
        post.media = { reddit_video: { fallback_url: fallbackUrl } };
        delete post._vreddit;
    }));
}

async function fetchRedditRss(subreddit, sort, query) {
    const rssUrl = new URL(`https://www.reddit.com/r/${subreddit}/${sort}/.rss`);
    for (const key of ['limit', 't', 'after']) {
        if (query.get(key)) rssUrl.searchParams.set(key, query.get(key));
    }

    const res = await fetch(rssUrl.toString(), {
        headers: {
            'User-Agent': REDDIT_USER_AGENT,
            'Accept': 'application/atom+xml, application/xml;q=0.9, */*;q=0.8'
        }
    });
    if (!res.ok) {
        throw new Error(`RSS fallback failed (HTTP ${res.status})`);
    }

    const xml = await res.text();
    if (!xml.includes('<feed')) {
        throw new Error('RSS fallback returned no feed');
    }

    const posts = parseRedditAtom(xml);
    await resolveRedditVideos(posts);

    return {
        kind: 'Listing',
        data: {
            after: posts.length > 0 ? posts[posts.length - 1].name : null,
            children: posts.map(p => ({ kind: 't3', data: p }))
        }
    };
}

/**
 * Serves a Reddit API URL (e.g. https://old.reddit.com/r/pics/hot.json?limit=100).
 * Reddit rejects unauthenticated *.json requests since mid-2026, so this uses
 * OAuth when credentials are configured and falls back to the RSS feed otherwise.
 */
async function handleReddit(targetUrl) {
    const url = new URL(targetUrl);
    const path = url.pathname.replace(/\.json$/, '').replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(url.search);
    query.delete('jsonp');

    const errors = [];

    if (env('REDDIT_CLIENT_ID')) {
        try {
            const res = await fetchRedditOAuth(path, query);
            if (res.ok) {
                return new Response(res.body, {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Reddit-Source': 'oauth' }
                });
            }
            if (res.status === 404) {
                return jsonResponse({ error: 'Subreddit not found' }, 404);
            }
            errors.push(`OAuth request failed (HTTP ${res.status})`);
        } catch (e) {
            errors.push(e.message);
        }
    } else {
        errors.push('REDDIT_CLIENT_ID not configured');
    }

    const listing = path.match(/^\/r\/([A-Za-z0-9_+]+)(?:\/([a-z]+))?$/);
    if (listing && (!listing[2] || REDDIT_SORTS.includes(listing[2]))) {
        try {
            const data = await fetchRedditRss(listing[1], listing[2] || 'hot', query);
            return jsonResponse(data, 200, { 'X-Reddit-Source': 'rss' });
        } catch (e) {
            errors.push(e.message);
        }
    }

    return jsonResponse({
        error: 'Reddit blocked the request. Configure REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET on the Worker.',
        code: 'reddit_blocked',
        details: errors
    }, 502);
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

function igCookie() {
    const sessionId = env('IG_SESSIONID');
    if (!sessionId) return '';
    // sessionid starts with the numeric account id ("<ds_user_id>%3A...")
    const dsUserId = decodeURIComponent(sessionId).split(':')[0];
    return /^\d+$/.test(dsUserId)
        ? `sessionid=${sessionId}; ds_user_id=${dsUserId}`
        : `sessionid=${sessionId}`;
}

function igHeaders(username, accept = '*/*') {
    const headers = {
        'User-Agent': BROWSER_USER_AGENT,
        'X-IG-App-ID': IG_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': accept,
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://${IG_HOST}/${username ? `${username}/` : ''}`,
        'X-IG-WWW-Claim': '0',
        'X-ASBD-ID': '129477'
    };
    const cookie = igCookie();
    if (cookie) headers['Cookie'] = cookie;
    return headers;
}

function igIosHeaders() {
    return {
        'User-Agent': IG_IOS_USER_AGENT,
        'X-IG-App-ID': IG_IOS_APP_ID,
        'Accept': '*/*',
        'Accept-Language': 'en-US',
        'Cookie': igCookie()
    };
}

/**
 * Fetches an Instagram API URL and never throws on non-JSON answers
 * (login walls come back as redirects or HTML pages).
 *
 * @returns {Promise<{ok: boolean, status: number, data?: Object, reason?: string}>}
 */
async function igFetchJson(url, headers) {
    let res;
    try {
        res = await fetch(url, { headers, redirect: 'manual' });
    } catch (e) {
        return { ok: false, status: 502, reason: e.message };
    }

    if (res.status >= 300 && res.status < 400) {
        return { ok: false, status: 401, reason: 'login_required' };
    }

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, status: res.ok ? 401 : res.status, reason: 'login_required' };
    }

    if (!res.ok || data.status === 'fail') {
        const reason = data.message || `HTTP ${res.status}`;
        const status = res.status === 404 ? 404
            : res.status === 429 || /wait a few minutes/i.test(reason) ? 429
            : res.status >= 400 && res.status < 500 ? 401
            : 502;
        return { ok: false, status, reason };
    }

    return { ok: true, status: res.status, data };
}

/**
 * GETs an Instagram API path (e.g. /api/v1/feed/user/123/) via the web API.
 * With a session configured, falls back to the iOS app API, which has
 * separate (per-account) rate limits.
 */
async function igApiGet(path, username) {
    const web = await igFetchJson(`https://${IG_HOST}${path}`, igHeaders(username));
    if (web.ok || web.status === 404 || !igCookie()) return web;

    const ios = await igFetchJson(`https://${IG_IOS_HOST}${path}`, igIosHeaders());
    if (!ios.ok) ios.reason = `web: ${web.reason}; ios: ${ios.reason}`;
    return ios;
}

/**
 * Fetches one page of a user's feed (the paginated source of posts).
 * Tries the id-based web endpoint, the username-based one the Instagram
 * website itself uses, and (with a session) the iOS app API.
 *
 * @returns {Promise<{ok: boolean, status: number, data?: Object, attempts: Array<string>}>}
 */
async function fetchIgFeedPage(userId, username, maxId) {
    const query = `?count=12${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`;
    const variants = [];
    if (userId) {
        variants.push(['web:id', `https://${IG_HOST}/api/v1/feed/user/${userId}/${query}`, () => igHeaders(username)]);
    }
    if (username) {
        variants.push(['web:username', `https://${IG_HOST}/api/v1/feed/user/${encodeURIComponent(username)}/username/${query}`, () => igHeaders(username)]);
    }
    if (userId && igCookie()) {
        variants.push(['ios:id', `https://${IG_IOS_HOST}/api/v1/feed/user/${userId}/${query}`, igIosHeaders]);
    }

    const attempts = [];
    let last = { ok: false, status: 400, reason: 'no user id or username' };
    for (const [name, url, headers] of variants) {
        last = await igFetchJson(url, headers());
        if (last.ok && Array.isArray(last.data.items)) {
            attempts.push(`${name}: ok (${last.data.items.length} items)`);
            return { ...last, attempts };
        }
        attempts.push(`${name}: HTTP ${last.status} ${last.reason || 'no items'}`);
        if (last.ok) last = { ok: false, status: 502, reason: 'no items' };
    }
    return { ...last, attempts };
}

/** Builds the profile response from a feed page, or from fallback items if the feed failed */
function igProfileResponse(userInfo, feed, fallbackItems, fallbackFormat, debug) {
    if (feed.ok) {
        const items = feed.data.items;
        if (!userInfo.id && items[0]?.user?.pk) userInfo.id = String(items[0].user.pk);
        return jsonResponse({
            user: userInfo,
            items,
            item_format: 'v1',
            more_available: !!feed.data.more_available,
            next_max_id: feed.data.next_max_id || null,
            debug: [...debug, ...feed.attempts]
        });
    }
    return jsonResponse({
        user: userInfo,
        items: fallbackItems,
        item_format: fallbackFormat,
        more_available: false,
        next_max_id: null,
        warning: 'Feed endpoint failed – showing only the posts embedded in the profile (no pagination)',
        debug: [...debug, ...feed.attempts]
    });
}

/** Extracts the JSON object that follows `key` in a string (balanced-brace scan) */
function extractJsonObjectAfter(source, key) {
    const keyIndex = source.indexOf(key);
    if (keyIndex === -1) return null;
    const start = source.indexOf('{', keyIndex + key.length);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(source.slice(start, i + 1));
                } catch (e) {
                    return null;
                }
            }
        }
    }
    return null;
}

/**
 * Fallback for logged-out access: the public profile page embeds the first
 * timeline page as JSON for client-side hydration.
 */
async function fetchInstagramProfileFromHtml(username) {
    const headers = igHeaders(username, 'text/html,application/xhtml+xml');
    delete headers['X-Requested-With'];

    let res;
    try {
        res = await fetch(`https://${IG_HOST}/${encodeURIComponent(username)}/`, {
            headers,
            redirect: 'manual'
        });
    } catch (e) {
        return null;
    }
    if (!res.ok) return null;

    const html = await res.text();
    const connection = extractJsonObjectAfter(html, '"xdt_api__v1__feed__user_timeline_graphql_connection"');
    const items = (connection?.edges || []).map(e => e?.node).filter(Boolean);
    if (items.length === 0) return null;

    const userId = (html.match(/"profile_id":"(\d+)"/) || html.match(/"page_id":"profilePage_(\d+)"/) || [])[1]
        || items[0]?.user?.pk || items[0]?.owner?.id || null;

    return {
        user: { id: userId ? String(userId) : null, username },
        items
    };
}

async function handleInstagramProfile(username) {
    if (!IG_USERNAME_RE.test(username)) {
        return jsonResponse({ error: 'Invalid username' }, 400);
    }

    // Step 1: resolve username → user_id via web_profile_info
    const profile = await igApiGet(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        username
    );

    const hasSession = !!env('IG_SESSIONID');
    const debug = [`session: ${hasSession ? 'yes' : 'no'}`, `web_profile_info: ${profile.ok ? 'ok' : `HTTP ${profile.status} ${profile.reason}`}`];

    if (!profile.ok) {
        if (profile.status === 404) {
            return jsonResponse({ error: 'Profile not found' }, 404);
        }

        // Fallback: parse the profile page (embeds the first 12 posts)
        const fromHtml = await fetchInstagramProfileFromHtml(username);
        debug.push(`profile html: ${fromHtml ? `ok (${fromHtml.items.length} items)` : 'failed'}`);

        // With a session the feed endpoint may still work (and paginates)
        if (fromHtml || hasSession) {
            const userId = fromHtml?.user.id || null;
            const feed = await fetchIgFeedPage(userId, username, null);
            if (feed.ok || fromHtml) {
                return igProfileResponse({ id: userId, username }, feed, fromHtml?.items || [], 'v1', debug);
            }
            debug.push(...feed.attempts);
        }

        let error;
        if (hasSession) {
            error = profile.status === 429
                ? 'Instagram rate limit for the configured account – try again later'
                : 'Instagram rejected the configured IG_SESSIONID (expired or logged out?)';
        } else {
            error = profile.status === 429
                ? 'Instagram blocks anonymous requests from the Worker (rate limit). Set the IG_SESSIONID secret on the Worker.'
                : 'Instagram requires a login. Set the IG_SESSIONID secret on the Worker.';
        }
        return jsonResponse({
            error,
            reason: profile.reason,
            session_configured: hasSession,
            debug
        }, profile.status === 429 ? 429 : 401);
    }

    const user = profile.data?.data?.user;
    if (!user || !user.id) {
        return jsonResponse({ error: 'Profile not found' }, 404);
    }

    if (user.is_private && !user.followed_by_viewer) {
        return jsonResponse({
            error: 'Profile is private',
            user: { id: user.id, username: user.username, full_name: user.full_name, is_private: true }
        }, 403);
    }

    const userInfo = { id: user.id, username: user.username, full_name: user.full_name };

    // Step 2: fetch first feed page (needs a session on most profiles).
    // If it fails, fall back to the GraphQL-style items embedded in the profile response.
    const feed = await fetchIgFeedPage(user.id, user.username || username, null);
    const edges = user.edge_owner_to_timeline_media?.edges || [];
    return igProfileResponse(userInfo, feed, edges.map(e => e.node), 'graphql', debug);
}

async function handleInstagramFeed(userId, username, maxId) {
    if (!IG_USER_ID_RE.test(userId)) {
        return jsonResponse({ error: 'Invalid user_id' }, 400);
    }
    if (username && !IG_USERNAME_RE.test(username)) {
        return jsonResponse({ error: 'Invalid username' }, 400);
    }
    if (maxId && !IG_MAX_ID_RE.test(maxId)) {
        return jsonResponse({ error: 'Invalid max_id' }, 400);
    }

    const feed = await fetchIgFeedPage(userId, username || '', maxId);
    if (!feed.ok) {
        return jsonResponse(
            { error: 'Feed fetch failed', reason: feed.reason, status: feed.status, more_available: false, debug: feed.attempts },
            feed.status
        );
    }

    return jsonResponse({
        items: feed.data.items || [],
        item_format: 'v1',
        more_available: !!feed.data.more_available,
        next_max_id: feed.data.next_max_id || null
    });
}

// ---------------------------------------------------------------------------
// Generic passthrough
// ---------------------------------------------------------------------------

async function handleGenericProxy(targetUrl, request) {
    let targetHost;
    try {
        targetHost = new URL(targetUrl).hostname;
    } catch (e) {
        return jsonResponse({ error: 'Invalid URL' }, 400);
    }

    if (!isHostAllowed(targetHost)) {
        return jsonResponse({ error: 'Domain not allowed' }, 403);
    }

    if (REDDIT_HOSTS.includes(targetHost)) {
        return handleReddit(targetUrl);
    }

    const headers = new Headers();
    headers.set('User-Agent', BROWSER_USER_AGENT);

    if (targetHost === _xvm()) {
        headers.set('Accept', '*/*');
        headers.set('Referer', _xvr());
        headers.set('Origin', _xvo());
    } else if (ALLOWED_HOST_SUFFIXES.some(s => targetHost.endsWith(s))) {
        // Instagram CDN prefers no custom referer
        headers.set('Accept', '*/*');
    } else {
        headers.set('Accept', 'application/json');
    }

    const passHeaders = ['Authorization', 'Content-Type'];
    for (const h of passHeaders) {
        if (request.headers.has(h)) {
            headers.set(h, request.headers.get(h));
        }
    }

    try {
        const response = await fetch(targetUrl, { headers });
        const responseHeaders = new Headers(response.headers);
        Object.keys(corsHeaders).forEach(key => {
            responseHeaders.set(key, corsHeaders[key]);
        });
        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders
        });
    } catch (error) {
        return jsonResponse({ error: 'Fetch failed', message: error.message }, 502);
    }
}

async function handleRequest(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const params = url.searchParams;

    // Diagnostics: which secrets are configured (never their values)
    if (params.has('status')) {
        return jsonResponse({
            reddit_oauth: !!env('REDDIT_CLIENT_ID'),
            reddit_oauth_confidential: !!env('REDDIT_CLIENT_SECRET'),
            ig_session: !!env('IG_SESSIONID')
        });
    }

    // Instagram profile + first feed page
    const igUsername = params.get('ig');
    if (igUsername) {
        return handleInstagramProfile(igUsername);
    }

    // Instagram feed pagination
    const igUserId = params.get('ig_feed');
    if (igUserId) {
        return handleInstagramFeed(igUserId, params.get('u'), params.get('max_id'));
    }

    // Generic passthrough
    const targetUrl = params.get('url');
    if (!targetUrl) {
        return jsonResponse({ error: 'Missing url parameter' }, 400);
    }

    return handleGenericProxy(targetUrl, request);
}

/**
 * Uncaught exceptions would surface as Cloudflare error pages without CORS
 * headers, which the browser reports as an opaque "Failed to fetch".
 */
async function handleRequestSafe(request) {
    try {
        return await handleRequest(request);
    } catch (error) {
        return jsonResponse({ error: 'Worker error', message: error.message }, 500);
    }
}
