/**
 * Cloudflare Worker - Reddit Viewer Proxy (Service Worker format)
 *
 * Proxies requests to Reddit and external video APIs to bypass CORS restrictions.
 */

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

// Encoded external domains
const _xva = () => atob('YXBpLnJlZGdpZnMuY29t');
const _xvm = () => atob('bWVkaWEucmVkZ2lmcy5jb20=');
const _xvr = () => atob('aHR0cHM6Ly93d3cucmVkZ2lmcy5jb20v');
const _xvo = () => atob('aHR0cHM6Ly93d3cucmVkZ2lmcy5jb20=');

async function handleRequest(request) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Only allow Reddit and the external video API
    const allowed = ['old.reddit.com', 'www.reddit.com', _xva(), _xvm()];
    let targetHost;
    try {
        targetHost = new URL(targetUrl).hostname;
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    if (!allowed.includes(targetHost)) {
        return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Set appropriate Accept header based on target
    if (targetHost === _xvm()) {
        headers.set('Accept', '*/*');
        headers.set('Referer', _xvr());
        headers.set('Origin', _xvo());
    } else {
        headers.set('Accept', 'application/json');
    }

    // Pass through headers for external video API
    const passHeaders = ['Authorization', 'Content-Type'];
    for (const h of passHeaders) {
        if (request.headers.has(h)) {
            headers.set(h, request.headers.get(h));
        }
    }

    try {
        const response = await fetch(targetUrl, { headers });
        const responseHeaders = new Headers(response.headers);

        // Add CORS headers
        Object.keys(corsHeaders).forEach(key => {
            responseHeaders.set(key, corsHeaders[key]);
        });

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Fetch failed', message: error.message }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}
