// Relative import (not the "@/" alias used elsewhere): this file is loaded
// directly by plain `node --test` via lib/apiProxyHandler.test.js, which
// only understands Node's native ESM resolution, not the Next.js/TS path
// alias.
import { classifyOrigin, isSameOriginReferer } from '../../lib/apiOrigin.js';

const ALLOWED_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS_CAP = 8000;

// What the client actually sends: POST with a JSON body, nothing else.
const CORS_ALLOWED_METHODS = 'POST';
const CORS_ALLOWED_HEADERS = 'Content-Type';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

export default async function handler(req, res) {
  const host = req.headers.host;
  const originHeader = req.headers.origin;
  const originClass = classifyOrigin(originHeader, host);

  // Only Herbiose's own native app shells are cross-origin callers by
  // design (they run from a local WebView origin, not the deployed host),
  // so only that class ever gets CORS headers — and always the exact
  // request origin, never `*`. Same-origin web requests need no CORS
  // headers at all; the browser only cross-origin-checks the native case.
  if (originClass === 'native') {
    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    if (originClass === 'native') {
      res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
    }
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isAllowed =
    originClass === 'native' ||
    originClass === 'same-origin' ||
    (!originHeader && isSameOriginReferer(req.headers.referer, host));

  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const requestedMaxTokens = Number(body.max_tokens);
  const max_tokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
    ? Math.min(requestedMaxTokens, MAX_TOKENS_CAP)
    : MAX_TOKENS_CAP;

  const upstreamBody = {
    model: ALLOWED_MODEL,
    max_tokens,
    messages: [...body.messages, { role: 'assistant', content: '{' }],
  };
  if (typeof body.system === 'string') {
    upstreamBody.system = body.system;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(upstreamBody),
    });

    const data = await response.json();
    if (data.content && data.content[0] && data.content[0].text) {
      data.content[0].text = '{' + data.content[0].text;
    }
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Anthropic proxy error:', error);
    return res.status(502).json({ error: 'Upstream request failed' });
  }
}
