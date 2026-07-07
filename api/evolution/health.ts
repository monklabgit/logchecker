const cleanBaseUrl = (value = '') => value.trim().replace(/\/+$/, '');

const sendJson = (res: any, status: number, payload: unknown) =>
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const baseUrl = cleanBaseUrl(process.env.EVOLUTION_API_URL || '');
  const apiKey = (process.env.EVOLUTION_API_KEY || '').trim();

  if (!baseUrl || !apiKey) {
    return sendJson(res, 500, {
      configured: false,
      hasUrl: Boolean(baseUrl),
      hasKey: Boolean(apiKey),
    });
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

    return sendJson(res, response.ok ? 200 : 502, {
      configured: true,
      reachable: response.ok,
      status: response.status,
      statusText: response.statusText,
      sampleType: Array.isArray(payload) ? 'array' : typeof payload,
    });
  } catch (error) {
    return sendJson(res, 502, {
      configured: true,
      reachable: false,
      error: error instanceof Error ? error.message : 'Evolution API request failed',
    });
  }
}
