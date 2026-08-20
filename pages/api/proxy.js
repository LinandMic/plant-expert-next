const ALLOWED_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS_CAP = 8000;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

function isRequestFromAllowedOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;

  const originHeader = req.headers.origin;
  if (originHeader) {
    try {
      return new URL(originHeader).host === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return false;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isRequestFromAllowedOrigin(req)) {
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
