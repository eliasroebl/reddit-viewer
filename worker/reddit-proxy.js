/**
 * Cloudflare Worker - Reddit Viewer Proxy (Service Worker format)
 *
 * Proxies requests to Reddit, external video APIs, and Instagram to bypass CORS.
 *
 * Supported query params:
 *   ?url=<encoded>                        – generic passthrough for whitelisted hosts
 *   ?ig=<username>                        – Instagram profile: resolves user_id then returns first feed page
 *   ?ig_feed=<user_id>&max_id=<cursor>    – Instagram feed pagination
 */

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

// Encoded external domains
const _xva = () => atob('YXBpLnJlZGdpZnMuY29t');
const _xvm = () => atob('bWVkaWEucmVkZ2lmcy5jb20=');
const _xvr = () => atob('aHR0cHM6Ly93d3cucmVkZ2lmcy5jb20v');
const _xvo = () => atob('aHR0cHM6Ly93d3cucmVkZ2lmcy5jb20=');

// Instagram config
const IG_APP_ID = '936619743392459';
const IG_USER_AGENT = 'Instagram 219.0.0.12.117 Android (30/11; 320dpi; 720x1440; samsung; SM-A205F; a20; exynos7884; en_US; 346138365)';
const IG_HOST = 'i.instagram.com';

const IG_USERNAME_RE = /^[a-zA-Z0-9_.]{1,30}$/;
const IG_USER_ID_RE = /^\d{1,20}$/;
const IG_MAX_ID_RE = /^[a-zA-Z0-9_=-]{1,200}$/;

// Hosts allowed for generic ?url= passthrough
const ALLOWED_HOSTS = ['old.reddit.com', 'www.reddit.com', _xva(), _xvm(), IG_HOST];

// Host suffixes allowed for media proxying (CDN domains have dynamic subdomains)
const ALLOWED_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net'];

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

function isHostAllowed(host) {
    if (ALLOWED_HOSTS.includes(host)) return true;
    return ALLOWED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

async function fetchInstagram(url) {
    const headers = new Headers();
    headers.set('User-Agent', IG_USER_AGENT);
    headers.set('X-IG-App-ID', IG_APP_ID);
    headers.set('Accept', '*/*');
    return fetch(url, { headers });
}

async function handleInstagramProfile(username) {
    if (!IG_USERNAME_RE.test(username)) {
        return jsonResponse({ error: 'Invalid username' }, 400);
    }

    // Step 1: resolve username → user_id via web_profile_info
    const profileUrl = `https://${IG_HOST}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const profileRes = await fetchInstagram(profileUrl);

    if (!profileRes.ok) {
        return jsonResponse(
            { error: 'Profile fetch failed', status: profileRes.status },
            profileRes.status === 404 ? 404 : 502
        );
    }

    const profileData = await profileRes.json();
    const user = profileData?.data?.user;

    if (!user || !user.id) {
        return jsonResponse({ error: 'Profile not found' }, 404);
    }

    if (user.is_private) {
        return jsonResponse({
            error: 'Profile is private',
            user: { id: user.id, username: user.username, full_name: user.full_name, is_private: true }
        }, 403);
    }

    // Step 2: fetch first feed page
    const feedUrl = `https://${IG_HOST}/api/v1/feed/user/${user.id}/?count=33`;
    const feedRes = await fetchInstagram(feedUrl);

    if (!feedRes.ok) {
        // Fall back to GraphQL-style items embedded in profile response
        const edges = user.edge_owner_to_timeline_media?.edges || [];
        return jsonResponse({
            user: { id: user.id, username: user.username, full_name: user.full_name },
            items: edges.map(e => e.node),
            item_format: 'graphql',
            more_available: false,
            next_max_id: null
        });
    }

    const feedData = await feedRes.json();
    return jsonResponse({
        user: { id: user.id, username: user.username, full_name: user.full_name },
        items: feedData.items || [],
        item_format: 'v1',
        more_available: !!feedData.more_available,
        next_max_id: feedData.next_max_id || null
    });
}

async function handleInstagramFeed(userId, maxId) {
    if (!IG_USER_ID_RE.test(userId)) {
        return jsonResponse({ error: 'Invalid user_id' }, 400);
    }
    if (maxId && !IG_MAX_ID_RE.test(maxId)) {
        return jsonResponse({ error: 'Invalid max_id' }, 400);
    }

    let feedUrl = `https://${IG_HOST}/api/v1/feed/user/${userId}/?count=33`;
    if (maxId) feedUrl += `&max_id=${encodeURIComponent(maxId)}`;

    const res = await fetchInstagram(feedUrl);
    if (!res.ok) {
        return jsonResponse(
            { error: 'Feed fetch failed', status: res.status, more_available: false },
            res.status
        );
    }

    const data = await res.json();
    return jsonResponse({
        items: data.items || [],
        item_format: 'v1',
        more_available: !!data.more_available,
        next_max_id: data.next_max_id || null
    });
}

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

    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

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

    // Instagram profile + first feed page
    const igUsername = params.get('ig');
    if (igUsername) {
        return handleInstagramProfile(igUsername);
    }

    // Instagram feed pagination
    const igUserId = params.get('ig_feed');
    if (igUserId) {
        return handleInstagramFeed(igUserId, params.get('max_id'));
    }

    // Generic passthrough
    const targetUrl = params.get('url');
    if (!targetUrl) {
        return jsonResponse({ error: 'Missing url parameter' }, 400);
    }

    return handleGenericProxy(targetUrl, request);
}
