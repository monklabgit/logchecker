const jsonHeaders = {
  'Content-Type': 'application/json',
};

const cleanBaseUrl = (value = '') => value.trim().replace(/\/+$/, '');

export default async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders });
  }

  const baseUrl = cleanBaseUrl(process.env.EVOLUTION_API_URL || '');
  const apiKey = (process.env.EVOLUTION_API_KEY || '').trim();

  if (!baseUrl || !apiKey) {
    return new Response(
      JSON.stringify({
        configured: false,
        hasUrl: Boolean(baseUrl),
        hasKey: Boolean(apiKey),
      }),
      { status: 500, headers: jsonHeaders }
    );
  }

  try {
    const response = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: {
        apikey: apiKey,
      },
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text.slice(0, 180);
    }

    return new Response(
      JSON.stringify({
        configured: true,
        reachable: response.ok,
        status: response.status,
        statusText: response.statusText,
        sampleType: Array.isArray(payload) ? 'array' : typeof payload,
      }),
      { status: response.ok ? 200 : 502, headers: jsonHeaders }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        configured: true,
        reachable: false,
        error: error instanceof Error ? error.message : 'Evolution API request failed',
      }),
      { status: 502, headers: jsonHeaders }
    );
  }
};

export const config = {
  path: '/api/evolution/health',
};
