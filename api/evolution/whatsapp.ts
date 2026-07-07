import { createClient } from '@supabase/supabase-js';

const cleanBaseUrl = (value = '') => value.trim().replace(/\/+$/, '');
const instancePrefix = () => (process.env.EVOLUTION_INSTANCE_PREFIX || 'logchecker').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'logchecker';
const defaultGroupJid = process.env.LOGCHECKER_WHATSAPP_GROUP_JID || '120363426513754062@g.us';
const defaultGroupName = process.env.LOGCHECKER_WHATSAPP_GROUP_NAME || 'MARJA - Rotina Mensal';
const supabaseProjectUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://lkuggbejehlaxpoykwcs.supabase.co';
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_vjE_pfGQ3RDyQo4UoItU6w_gvnmeTUy';

type NotifyEventType = 'delivery_completed' | 'release_completed' | 'pickup_completed';

type WhatsappBody = {
  action?: string;
  requestId?: string;
  eventType?: NotifyEventType;
  photoPaths?: string[];
};

const sendJson = (res: any, status: number, payload: unknown) =>
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));

const bodyFromRequest = (req: any): WhatsappBody => {
  if (req.body && typeof req.body === 'object') return req.body as WhatsappBody;
  if (typeof req.body === 'string') return JSON.parse(req.body) as WhatsappBody;
  return {};
};

const slugPart = (value = '') =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34);

const instanceNameCandidate = (fullName: string, userId: string, suffix = 0) => {
  const readableName = slugPart(fullName) || `usuario-${userId.replace(/-/g, '').slice(0, 8)}`;
  return `${instancePrefix()}-${readableName}${suffix ? `-${suffix}` : ''}`;
};

const evolutionConfig = () => {
  const baseUrl = cleanBaseUrl(process.env.EVOLUTION_API_URL || '');
  const apiKey = (process.env.EVOLUTION_API_KEY || '').trim();
  if (!baseUrl || !apiKey) throw new Error('Evolution API is not configured');
  return { baseUrl, apiKey };
};

const readJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const evolutionFetch = async (path: string, init: RequestInit = {}) => {
  const { baseUrl, apiKey } = evolutionConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {}),
    },
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const detail =
      payload?.response?.message ||
      payload?.error?.message ||
      payload?.message ||
      response.statusText ||
      'Evolution API request failed';
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
};

const formatDate = (value: string | null) => {
  if (!value) return 'Não informada';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(`${value}T12:00:00`));
};

const formatTime = (value: string | null) => {
  if (!value) return 'Não informado';
  const [hour = '', minute = ''] = value.split(':');
  return `${hour}${minute ? `H${minute === '00' ? '' : minute}` : 'H'}`;
};

const titleForEvent = (eventType: NotifyEventType) => {
  if (eventType === 'delivery_completed') return 'ENTRADA';
  if (eventType === 'release_completed') return 'LIBERAÇÃO';
  return 'RETIRADA';
};

const actionLineForEvent = (eventType: NotifyEventType) => {
  if (eventType === 'delivery_completed') return 'Entrega concluída por';
  if (eventType === 'release_completed') return 'Material liberado por';
  return 'Retirada concluída por';
};

const sectionBlock = (
  request: { request_items: Array<{ section: string; quantity: string; description: string; note: string }> },
  section: 'CME' | 'OPME'
) => {
  const items = request.request_items.filter((item) => item.section === section);
  if (!items.length) return `${section}\n----------\nNão informado`;
  return [
    section,
    '----------',
    ...items.map((item) => [item.quantity || '-', item.description || '-', item.note || ''].filter(Boolean).join(' | ')),
  ].join('\n');
};

const buildNotificationMessage = (
  request: {
    hospital: string;
    surgeon: string;
    patient: string;
    surgery_date: string | null;
    surgery_time: string | null;
    procedure: string;
    request_items: Array<{ section: string; quantity: string; description: string; note: string }>;
  },
  eventType: NotifyEventType,
  actorName: string,
  photoCount: number
) => {
  const title = `${titleForEvent(eventType)} - ${request.hospital}`;
  return [
    '===============',
    title,
    '===============',
    `Cirurgião: ${request.surgeon || 'Não informado'}`,
    `Paciente: ${request.patient || 'Não informado'}`,
    `Data da Cirurgia: ${formatDate(request.surgery_date)}`,
    `Horário da Cirurgia: ${formatTime(request.surgery_time)}`,
    `Procedimento: ${request.procedure || 'Não informado'}`,
    '===============',
    sectionBlock(request, 'CME'),
    '----------',
    sectionBlock(request, 'OPME'),
    '===============',
    `${actionLineForEvent(eventType)}: ${actorName || 'Usuário LogChecker'}`,
    photoCount ? `Evidências: ${photoCount} foto${photoCount === 1 ? '' : 's'}` : '',
    '===============',
  ].filter(Boolean).join('\n');
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return sendJson(res, 401, { error: 'Sessão ausente. Entre novamente para conectar o WhatsApp.' });
  }

  const supabase = createClient(supabaseProjectUrl, supabasePublishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return sendJson(res, 401, { error: 'Invalid session' });
  }

  let body: WhatsappBody = {};
  try {
    body = bodyFromRequest(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' });
  }

  const profileId = userData.user.id;
  const action = body.action || 'status';

  const getProfileName = async () => {
    const { data } = await supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
    return (data?.full_name || userData.user.email || '').trim();
  };

  const updateConnection = async (values: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from('user_whatsapp_connections')
      .update(values)
      .eq('profile_id', profileId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  };

  const getConnection = async () => {
    const { data, error } = await supabase
      .from('user_whatsapp_connections')
      .select('*')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error) throw error;
    return data as { instance_name: string; connection_state: string; group_jid: string; group_name: string } | null;
  };

  const ensureDefaultGroup = async (connection: { group_jid: string; group_name: string } | null) => {
    if (!connection || (connection.group_jid && connection.group_name)) return connection;
    return updateConnection({
      group_jid: defaultGroupJid,
      group_name: defaultGroupName,
    });
  };

  const ensureConnection = async () => {
    const existing = await getConnection();
    if (existing) return (await ensureDefaultGroup(existing)) as { instance_name: string; connection_state: string; group_jid: string; group_name: string };

    const profileName = await getProfileName();
    let lastError: unknown = null;

    for (let suffix = 0; suffix <= 20; suffix += 1) {
      const instanceName = instanceNameCandidate(profileName, profileId, suffix);
      const { data, error } = await supabase
        .from('user_whatsapp_connections')
        .insert({
          profile_id: profileId,
          instance_name: instanceName,
          connection_state: 'close',
          group_jid: defaultGroupJid,
          group_name: defaultGroupName,
        })
        .select('*')
        .single();

      if (!error && data) return data as { instance_name: string; connection_state: string; group_jid: string; group_name: string };
      lastError = error;
      if (!/duplicate|unique/i.test(error?.message || '')) break;
    }

    throw lastError || new Error('Não foi possível criar a instância do WhatsApp.');
  };

  try {
    if (action === 'status') {
      const connection = await getConnection();
      if (!connection) {
        return sendJson(res, 200, { connection: null, state: 'not_configured' });
      }

      const statePayload = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(connection.instance_name)}`);
      const state = statePayload?.instance?.state || statePayload?.state || 'close';
      const updated = await updateConnection({
        connection_state: state,
        connected_at: state === 'open' ? new Date().toISOString() : null,
        group_jid: connection.group_jid || defaultGroupJid,
        group_name: connection.group_name || defaultGroupName,
      });

      return sendJson(res, 200, { connection: updated, state });
    }

    if (action === 'connect') {
      const connection = await ensureConnection();
      const instanceName = connection.instance_name;

      try {
        await evolutionFetch('/instance/create', {
          method: 'POST',
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/already|exist|409|400/i.test(message)) throw error;
      }

      const qrPayload = await evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`);
      const base64 = qrPayload?.base64 || qrPayload?.qrcode?.base64 || '';
      const updated = await updateConnection({
        connection_state: 'connecting',
        last_qr_at: new Date().toISOString(),
      });

      return sendJson(res, 200, { connection: updated, qrcode: base64, payload: qrPayload });
    }

    if (action === 'logout') {
      const connection = await getConnection();
      if (!connection) {
        return sendJson(res, 200, { connection: null, state: 'not_configured' });
      }
      await evolutionFetch(`/instance/logout/${encodeURIComponent(connection.instance_name)}`, { method: 'DELETE' });
      const updated = await updateConnection({ connection_state: 'close', connected_at: null });
      return sendJson(res, 200, { connection: updated, state: 'close' });
    }

    if (action === 'notify_operation') {
      if (!body.requestId || !body.eventType) {
        return sendJson(res, 400, { error: 'requestId and eventType are required' });
      }

      const [{ data: request, error: requestError }, { data: profile }] = await Promise.all([
        supabase
          .from('surgery_requests')
          .select('id, hospital, surgeon, patient, surgery_date, surgery_time, procedure, request_items(section, quantity, description, note)')
          .eq('id', body.requestId)
          .single(),
        supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle(),
      ]);

      if (requestError) throw requestError;

      const connection = await ensureConnection();
      if (connection.connection_state !== 'open') {
        return sendJson(res, 200, { skipped: true, reason: 'WhatsApp não conectado.' });
      }

      const photoPaths = Array.from(new Set((body.photoPaths || []).filter(Boolean)));
      const { data: photos } = photoPaths.length
        ? await supabase
            .from('transport_evidence_photos')
            .select('storage_path, original_name, mime_type')
            .eq('request_id', body.requestId)
            .in('storage_path', photoPaths)
        : { data: [] };

      const message = buildNotificationMessage(
        request as {
          hospital: string;
          surgeon: string;
          patient: string;
          surgery_date: string | null;
          surgery_time: string | null;
          procedure: string;
          request_items: Array<{ section: string; quantity: string; description: string; note: string }>;
        },
        body.eventType,
        profile?.full_name || userData.user.email || '',
        photos?.length || 0
      );

      await evolutionFetch(`/message/sendText/${encodeURIComponent(connection.instance_name)}`, {
        method: 'POST',
        body: JSON.stringify({
          number: connection.group_jid,
          text: message,
        }),
      });

      let sentMedia = 0;
      for (const photo of photos || []) {
        const { data: signed } = await supabase.storage.from('transport-evidence-photos').createSignedUrl(photo.storage_path, 60 * 20);
        if (!signed?.signedUrl) continue;
        await evolutionFetch(`/message/sendMedia/${encodeURIComponent(connection.instance_name)}`, {
          method: 'POST',
          body: JSON.stringify({
            number: connection.group_jid,
            mediatype: 'image',
            mimetype: photo.mime_type || 'image/jpeg',
            media: signed.signedUrl,
            fileName: photo.original_name || 'evidencia.jpg',
            caption: `Evidência - ${titleForEvent(body.eventType)}`,
          }),
        });
        sentMedia += 1;
      }

      return sendJson(res, 200, { ok: true, sentMedia });
    }

    return sendJson(res, 400, { error: 'Unknown action' });
  } catch (error) {
    return sendJson(res, 502, {
      error: error instanceof Error ? error.message : 'WhatsApp action failed',
    });
  }
}
