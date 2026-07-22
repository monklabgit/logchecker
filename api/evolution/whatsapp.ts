import { createClient } from '@supabase/supabase-js';

const cleanBaseUrl = (value = '') => value.trim().replace(/\/+$/, '');
const instancePrefix = () => (process.env.EVOLUTION_INSTANCE_PREFIX || 'logchecker').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'logchecker';
const legacyGroupJid = '120363426513754062@g.us';
const currentGroupJid = '120363211296860448@g.us';
const currentGroupName = 'Marja logística Rio';
const configuredGroupJid = (process.env.LOGCHECKER_WHATSAPP_GROUP_JID || '').trim();
const configuredGroupName = (process.env.LOGCHECKER_WHATSAPP_GROUP_NAME || '').trim();
const configuredKitControlGroupJid = (process.env.LOGCHECKER_KIT_CONTROL_GROUP_JID || '').trim();
const configuredKitControlGroupName = (process.env.LOGCHECKER_KIT_CONTROL_GROUP_NAME || '').trim();
const defaultGroupJid = !configuredGroupJid || configuredGroupJid === legacyGroupJid ? currentGroupJid : configuredGroupJid;
const defaultGroupName = !configuredGroupName || configuredGroupJid === legacyGroupJid ? currentGroupName : configuredGroupName;
const supabaseProjectUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://lkuggbejehlaxpoykwcs.supabase.co';
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_vjE_pfGQ3RDyQo4UoItU6w_gvnmeTUy';

type NotifyEventType = 'delivery_completed' | 'release_completed' | 'pickup_completed' | 'kit_control';
type KitControlDispatchMode = 'pending' | 'current' | 'all';

type WhatsappBody = {
  action?: string;
  requestId?: string;
  eventType?: NotifyEventType;
  photoPaths?: string[];
  selectionMode?: KitControlDispatchMode;
  logisticsGroupJid?: string;
  logisticsGroupName?: string;
  kitControlGroupJid?: string;
  kitControlGroupName?: string;
};

type WhatsappConnection = {
  instance_name: string;
  connection_state: string;
  group_jid: string;
  group_name: string;
  kit_control_group_jid: string;
  kit_control_group_name: string;
};

type GlobalWhatsappGroups = {
  logistics_group_jid: string;
  logistics_group_name: string;
  kit_control_group_jid: string;
  kit_control_group_name: string;
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
  if (eventType === 'kit_control') return 'CONFERÊNCIA DE KITS';
  return 'RETIRADA';
};

const photoTypeForEvent = (eventType: NotifyEventType) => {
  if (eventType === 'delivery_completed') return 'delivery';
  if (eventType === 'release_completed') return 'instrumentator_release';
  if (eventType === 'kit_control') return 'kit_control';
  return 'pickup';
};

const actionLineForEvent = (eventType: NotifyEventType) => {
  if (eventType === 'delivery_completed') return 'Entrega concluída por';
  if (eventType === 'release_completed') return 'Material liberado por';
  if (eventType === 'kit_control') return 'Controle de Kits registrado por';
  return 'Retirada concluída por';
};

const requestCodeLabel = (code: number | null | undefined) =>
  typeof code === 'number' && Number.isFinite(code) ? `#${String(code).padStart(4, '0')}` : '#----';

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
    code: number;
    hospital: string;
    surgeon: string;
    patient: string;
    surgery_date: string | null;
    surgery_time: string | null;
    procedure: string;
    insurance: string;
    request_items: Array<{ section: string; quantity: string; description: string; note: string }>;
    transport_tasks: Array<{
      type: string;
      status: string;
      completed_at: string | null;
      delivery_received_cme: string;
      delivery_received_opme: string;
      delivery_observation: string;
    }>;
  },
  eventType: NotifyEventType,
  actorName: string,
  photoCount: number,
  kitControlSummary?: { total: number; mode: KitControlDispatchMode }
) => {
  const codeLabel = requestCodeLabel(request.code);
  const title = `${titleForEvent(eventType)} - ${request.hospital}`;
  const delivery = request.transport_tasks
    .filter((task) => task.type === 'delivery' && task.status === 'completed')
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))[0];
  const deliveryReceipt = eventType === 'delivery_completed'
    ? [
        'Recebido:',
        `CME - ${delivery?.delivery_received_cme || 'Não informado'}`,
        `OPME - ${delivery?.delivery_received_opme || 'Não informado'}`,
        delivery?.delivery_observation ? `Observação da entrega: ${delivery.delivery_observation}` : '',
        '===============',
      ]
    : [];
  return [
    '===============',
    title,
    '===============',
    `Solicitação: ${codeLabel}`,
    `Cirurgião: ${request.surgeon || 'Não informado'}`,
    `Paciente: ${request.patient || 'Não informado'}`,
    `Data da Cirurgia: ${formatDate(request.surgery_date)}`,
    `Horário da Cirurgia: ${formatTime(request.surgery_time)}`,
    `Procedimento: ${request.procedure || 'Não informado'}`,
    `Convênio: ${request.insurance || 'Não informado'}`,
    '===============',
    sectionBlock(request, 'CME'),
    '----------',
    sectionBlock(request, 'OPME'),
    '===============',
    ...deliveryReceipt,
    `${actionLineForEvent(eventType)}: ${actorName || 'Usuário LogChecker'}`,
    eventType === 'kit_control' && kitControlSummary
      ? `Evidências enviadas agora: ${photoCount}`
      : photoCount ? `Evidências: ${photoCount} foto${photoCount === 1 ? '' : 's'}` : '',
    eventType === 'kit_control' && kitControlSummary
      ? `Total registrado na solicitação: ${kitControlSummary.total}`
      : '',
    eventType === 'kit_control' && kitControlSummary
      ? `Tipo do envio: ${{ pending: 'Pendentes', current: 'Adicionadas agora', all: 'Todas' }[kitControlSummary.mode]}`
      : '',
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
  const eventAccess: Partial<Record<NotifyEventType, string>> = {
    delivery_completed: 'complete_delivery',
    release_completed: 'release_materials',
    pickup_completed: 'complete_pickup',
    kit_control: 'create_requests',
  };
  const requiredAccess = action === 'notify_operation' && body.eventType
    ? eventAccess[body.eventType]
    : 'manage_whatsapp';

  if (requiredAccess) {
    const { data: hasRequiredAccess, error: accessError } = await supabase.rpc('current_user_has_access', {
      target_access_key: requiredAccess,
    });
    if (accessError || !hasRequiredAccess) {
      return sendJson(res, 403, { error: 'Você não tem permissão para executar esta ação.' });
    }
  }

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
    return data as WhatsappConnection | null;
  };

  const getGlobalGroups = async (): Promise<GlobalWhatsappGroups> => {
    const { data, error } = await supabase
      .from('whatsapp_group_settings')
      .select('logistics_group_jid, logistics_group_name, kit_control_group_jid, kit_control_group_name')
      .eq('singleton', true)
      .single();
    if (error) throw error;
    return {
      logistics_group_jid: data.logistics_group_jid || defaultGroupJid,
      logistics_group_name: data.logistics_group_name || defaultGroupName,
      kit_control_group_jid: data.kit_control_group_jid || configuredKitControlGroupJid,
      kit_control_group_name: data.kit_control_group_name || configuredKitControlGroupName,
    };
  };

  const connectionWithGlobalGroups = (connection: WhatsappConnection, groups: GlobalWhatsappGroups): WhatsappConnection => ({
    ...connection,
    group_jid: groups.logistics_group_jid,
    group_name: groups.logistics_group_name,
    kit_control_group_jid: groups.kit_control_group_jid,
    kit_control_group_name: groups.kit_control_group_name,
  });
  const ensureDefaultGroups = async (connection: WhatsappConnection | null) => {
    if (!connection) return connection;
    const updates: Record<string, string> = {};
    if (!connection.group_jid && defaultGroupJid) updates.group_jid = defaultGroupJid;
    if (!connection.group_name && defaultGroupName) updates.group_name = defaultGroupName;
    if (!connection.kit_control_group_jid && configuredKitControlGroupJid) {
      updates.kit_control_group_jid = configuredKitControlGroupJid;
    }
    if (!connection.kit_control_group_name && configuredKitControlGroupName) {
      updates.kit_control_group_name = configuredKitControlGroupName;
    }
    return Object.keys(updates).length ? updateConnection(updates) : connection;
  };

  const ensureConnection = async () => {
    const existing = await getConnection();
    if (existing) return (await ensureDefaultGroups(existing)) as WhatsappConnection;

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
          kit_control_group_jid: configuredKitControlGroupJid,
          kit_control_group_name: configuredKitControlGroupName,
        })
        .select('*')
        .single();

      if (!error && data) return data as WhatsappConnection;
      lastError = error;
      if (!/duplicate|unique/i.test(error?.message || '')) break;
    }

    throw lastError || new Error('Não foi possível criar a instância do WhatsApp.');
  };

  const refreshConnectionState = async (connection: WhatsappConnection) => {
    const statePayload = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(connection.instance_name)}`);
    const state = statePayload?.instance?.state || statePayload?.state || 'close';
    return (await updateConnection({
      connection_state: state,
      connected_at: state === 'open' ? new Date().toISOString() : null,
      group_jid: connection.group_jid || defaultGroupJid,
      group_name: connection.group_name || defaultGroupName,
      kit_control_group_jid: connection.kit_control_group_jid || configuredKitControlGroupJid,
      kit_control_group_name: connection.kit_control_group_name || configuredKitControlGroupName,
    })) as WhatsappConnection;
  };

  try {
    if (action === 'status') {
      const [connection, groups] = await Promise.all([getConnection(), getGlobalGroups()]);
      if (!connection) {
        return sendJson(res, 200, { connection: null, groups, state: 'not_configured' });
      }

      const updated = await refreshConnectionState(connection);
      return sendJson(res, 200, {
        connection: connectionWithGlobalGroups(updated, groups),
        groups,
        state: updated.connection_state,
      });
    }

    if (action === 'save_groups') {
      const logisticsGroupJid = (body.logisticsGroupJid || '').trim();
      const logisticsGroupName = (body.logisticsGroupName || '').trim();
      const kitControlGroupJid = (body.kitControlGroupJid || '').trim();
      const kitControlGroupName = (body.kitControlGroupName || '').trim();
      const validGroupJid = /^\d+@g\.us$/;

      if (!validGroupJid.test(logisticsGroupJid)) {
        return sendJson(res, 400, { error: 'Informe um ID válido para o grupo de Logística.' });
      }
      if (!validGroupJid.test(kitControlGroupJid)) {
        return sendJson(res, 400, { error: 'Informe um ID válido para o grupo de Conferência de Kits.' });
      }
      if (!logisticsGroupName || !kitControlGroupName) {
        return sendJson(res, 400, { error: 'Informe o nome dos dois grupos.' });
      }

      const { data: isAdmin } = await supabase.rpc('is_admin');
      if (!isAdmin) {
        return sendJson(res, 403, { error: 'Somente administradores podem alterar os grupos.' });
      }

      const { data: groups, error: groupError } = await supabase
        .from('whatsapp_group_settings')
        .update({
          logistics_group_jid: logisticsGroupJid,
          logistics_group_name: logisticsGroupName,
          kit_control_group_jid: kitControlGroupJid,
          kit_control_group_name: kitControlGroupName,
          updated_by: profileId,
          updated_at: new Date().toISOString(),
        })
        .eq('singleton', true)
        .select('logistics_group_jid, logistics_group_name, kit_control_group_jid, kit_control_group_name')
        .single();
      if (groupError) throw groupError;

      const connection = await getConnection();
      return sendJson(res, 200, {
        connection: connection ? connectionWithGlobalGroups(connection, groups) : null,
        groups,
      });
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

      const groups = await getGlobalGroups();
      return sendJson(res, 200, {
        connection: connectionWithGlobalGroups(updated, groups),
        groups,
        qrcode: base64,
        payload: qrPayload,
      });
    }

    if (action === 'logout') {
      const connection = await getConnection();
      if (!connection) {
        const groups = await getGlobalGroups();
        return sendJson(res, 200, { connection: null, groups, state: 'not_configured' });
      }
      await evolutionFetch(`/instance/logout/${encodeURIComponent(connection.instance_name)}`, { method: 'DELETE' });
      const updated = await updateConnection({ connection_state: 'close', connected_at: null });
      const groups = await getGlobalGroups();
      return sendJson(res, 200, {
        connection: connectionWithGlobalGroups(updated, groups),
        groups,
        state: 'close',
      });
    }

    if (action === 'notify_operation') {
      if (!body.requestId || !body.eventType) {
        return sendJson(res, 400, { error: 'requestId and eventType are required' });
      }

      const [{ data: request, error: requestError }, { data: profile }] = await Promise.all([
        supabase
          .from('surgery_requests')
          .select('id, code, hospital, surgeon, patient, surgery_date, surgery_time, procedure, insurance, request_items(section, quantity, description, note), transport_tasks(type, status, completed_at, delivery_received_cme, delivery_received_opme, delivery_observation)')
          .eq('id', body.requestId)
          .single(),
        supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle(),
      ]);

      if (requestError) throw requestError;

      const connection = await ensureConnection();
      let activeConnection = connection;
      try {
        activeConnection = await refreshConnectionState(connection);
      } catch (stateError) {
        console.error('WhatsApp notification connection state check failed', {
          requestId: body.requestId,
          eventType: body.eventType,
          instanceName: connection.instance_name,
          error: stateError instanceof Error ? stateError.message : stateError,
        });
      }

      if (activeConnection.connection_state !== 'open') {
        console.warn('WhatsApp notification skipped', {
          requestId: body.requestId,
          eventType: body.eventType,
          instanceName: activeConnection.instance_name,
          connectionState: activeConnection.connection_state,
        });
        return sendJson(res, 200, {
          skipped: true,
          reason: 'WhatsApp não conectado.',
          state: activeConnection.connection_state,
        });
      }

      if (body.eventType === 'kit_control') {
        const { data: canCreateRequests } = await supabase.rpc('current_user_has_access', {
          target_access_key: 'create_requests',
        });
        if (!canCreateRequests) {
          return sendJson(res, 403, { error: 'Você não tem permissão para enviar o Controle de Kits.' });
        }
      }

      const photoPaths = Array.from(new Set((body.photoPaths || []).filter(Boolean)));
      const photoResult = photoPaths.length
        ? await supabase
            .from('transport_evidence_photos')
            .select('storage_path, original_name, mime_type')
            .eq('request_id', body.requestId)
            .eq('photo_type', photoTypeForEvent(body.eventType))
            .not('finalized_at', 'is', null)
            .gt('expires_at', new Date().toISOString())
            .in('storage_path', photoPaths)
        : { data: [], error: null };
      if (photoResult.error) throw photoResult.error;
      const photos = photoResult.data || [];
      if (body.eventType === 'kit_control' && !photos.length) {
        throw new Error('Nenhuma foto válida de Controle de Kits foi encontrada.');
      }

      const typedRequest = request as {
        code: number;
        hospital: string;
        surgeon: string;
        patient: string;
        surgery_date: string | null;
        surgery_time: string | null;
        procedure: string;
        insurance: string;
        request_items: Array<{ section: string; quantity: string; description: string; note: string }>;
        transport_tasks: Array<{
          type: string;
          status: string;
          completed_at: string | null;
          delivery_received_cme: string;
          delivery_received_opme: string;
          delivery_observation: string;
        }>;
      };
      const codeLabel = requestCodeLabel(typedRequest.code);
      const globalGroups = await getGlobalGroups();
      const targetGroupJid = body.eventType === 'kit_control'
        ? globalGroups.kit_control_group_jid
        : globalGroups.logistics_group_jid;
      if (!targetGroupJid) {
        throw new Error(body.eventType === 'kit_control'
          ? 'O grupo de Conferência de Kits não está configurado.'
          : 'O grupo de Logística não está configurado.');
      }

      if (body.eventType === 'kit_control') {
        const selectionMode: KitControlDispatchMode = ['pending', 'current', 'all'].includes(body.selectionMode || '')
          ? body.selectionMode as KitControlDispatchMode
          : 'pending';
        const { count: totalEvidence, error: totalError } = await supabase
          .from('transport_evidence_photos')
          .select('id', { count: 'exact', head: true })
          .eq('request_id', body.requestId)
          .eq('photo_type', 'kit_control')
          .not('finalized_at', 'is', null)
          .gt('expires_at', new Date().toISOString());
        if (totalError) throw totalError;

        const sentPaths: string[] = [];
        const failedPaths: string[] = [];
        for (const photo of photos) {
          try {
            const { data: signed, error: signedError } = await supabase.storage
              .from('transport-evidence-photos')
              .createSignedUrl(photo.storage_path, 60 * 20);
            if (signedError || !signed?.signedUrl) throw signedError || new Error('Não foi possível acessar a imagem.');
            await evolutionFetch(`/message/sendMedia/${encodeURIComponent(activeConnection.instance_name)}`, {
              method: 'POST',
              body: JSON.stringify({
                number: targetGroupJid,
                mediatype: 'image',
                mimetype: photo.mime_type || 'image/jpeg',
                media: signed.signedUrl,
                fileName: photo.original_name || 'evidencia.jpg',
                caption: `${titleForEvent(body.eventType)} ${codeLabel}`,
              }),
            });
            sentPaths.push(photo.storage_path);
          } catch (mediaError) {
            failedPaths.push(photo.storage_path);
            console.error('Kit Control media send failed', {
              requestId: body.requestId,
              storagePath: photo.storage_path,
              error: mediaError instanceof Error ? mediaError.message : mediaError,
            });
          }
        }

        if (!sentPaths.length) {
          throw new Error('Nenhuma foto foi enviada. As evidências continuam pendentes para uma nova tentativa.');
        }

        const { error: markError } = await supabase.rpc('mark_kit_control_evidence_sent', {
          target_request_id: body.requestId,
          target_storage_paths: sentPaths,
        });
        if (markError) throw markError;

        const message = buildNotificationMessage(
          typedRequest,
          body.eventType,
          profile?.full_name || userData.user.email || '',
          sentPaths.length,
          { total: totalEvidence || sentPaths.length, mode: selectionMode }
        );
        await evolutionFetch(`/message/sendText/${encodeURIComponent(activeConnection.instance_name)}`, {
          method: 'POST',
          body: JSON.stringify({ number: targetGroupJid, text: message }),
        });

        console.info('Kit Control WhatsApp notification sent', {
          requestId: body.requestId,
          instanceName: activeConnection.instance_name,
          selectionMode,
          sentMedia: sentPaths.length,
          failedMedia: failedPaths.length,
        });
        return sendJson(res, failedPaths.length ? 207 : 200, {
          ok: failedPaths.length === 0,
          sentMedia: sentPaths.length,
          failedMedia: failedPaths.length,
          sentPaths,
          failedPaths,
        });
      }

      const message = buildNotificationMessage(
        typedRequest,
        body.eventType,
        profile?.full_name || userData.user.email || '',
        photos.length
      );
      await evolutionFetch(`/message/sendText/${encodeURIComponent(activeConnection.instance_name)}`, {
        method: 'POST',
        body: JSON.stringify({ number: targetGroupJid, text: message }),
      });

      let sentMedia = 0;
      for (const photo of photos) {
        const { data: signed } = await supabase.storage.from('transport-evidence-photos').createSignedUrl(photo.storage_path, 60 * 20);
        if (!signed?.signedUrl) continue;
        await evolutionFetch(`/message/sendMedia/${encodeURIComponent(activeConnection.instance_name)}`, {
          method: 'POST',
          body: JSON.stringify({
            number: targetGroupJid,
            mediatype: 'image',
            mimetype: photo.mime_type || 'image/jpeg',
            media: signed.signedUrl,
            fileName: photo.original_name || 'evidencia.jpg',
            caption: `${titleForEvent(body.eventType)} ${codeLabel}`,
          }),
        });
        sentMedia += 1;
      }

      console.info('WhatsApp notification sent', {
        requestId: body.requestId,
        eventType: body.eventType,
        instanceName: activeConnection.instance_name,
        sentMedia,
      });

      return sendJson(res, 200, { ok: true, sentMedia, failedMedia: 0 });
    }

    return sendJson(res, 400, { error: 'Unknown action' });
  } catch (error) {
    return sendJson(res, 502, {
      error: error instanceof Error ? error.message : 'WhatsApp action failed',
    });
  }
}
