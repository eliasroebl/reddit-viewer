/**
 * Cloudflare Worker - Reddit Viewer Proxy (Service Worker format)
 *
 * Proxies requests to Reddit and external video APIs to bypass CORS restrictions.
 */

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

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
    const allowed = ['old.reddit.com', 'www.reddit.com', 'api.redgifs.com'];
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
    headers.set('User-Agent', 'Mozilla/5.0 (compatible; RedditViewer/1.0)');

    // Pass through Authorization for external video API
    if (request.headers.has('Authorization')) {
        headers.set('Authorization', request.headers.get('Authorization'));
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
