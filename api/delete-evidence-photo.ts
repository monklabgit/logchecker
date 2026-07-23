import { createClient } from '@supabase/supabase-js';

const bucketName = 'transport-evidence-photos';
const supabaseProjectUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const sendJson = (res: any, status: number, payload: unknown) =>
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));

const bodyFromRequest = (req: any) => {
  if (req.body && typeof req.body === 'object') return req.body as { photoId?: string };
  if (typeof req.body === 'string') return JSON.parse(req.body) as { photoId?: string };
  return {};
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  if (!supabaseProjectUrl || !supabasePublishableKey || !serviceRoleKey) {
    return sendJson(res, 500, { error: 'Supabase server credentials are not configured.' });
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return sendJson(res, 401, { error: 'Sessão ausente. Entre novamente para excluir a evidência.' });
  }

  let photoId = '';
  try {
    photoId = String(bodyFromRequest(req).photoId || '').trim();
  } catch {
    return sendJson(res, 400, { error: 'Corpo da requisição inválido.' });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
    return sendJson(res, 400, { error: 'Evidência inválida.' });
  }

  const userSupabase = createClient(supabaseProjectUrl, supabasePublishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const serviceSupabase = createClient(supabaseProjectUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await userSupabase.auth.getUser(token);
  if (userError || !userData.user) {
    return sendJson(res, 401, { error: 'Sessão inválida.' });
  }

  try {
    const { data: prepared, error: prepareError } = await userSupabase.rpc(
      'prepare_evidence_photo_deletion',
      { target_photo_id: photoId }
    );
    if (prepareError) throw prepareError;

    const storagePath = Array.isArray(prepared) ? prepared[0]?.storage_path : null;
    if (!storagePath) throw new Error('Evidência não encontrada ou sem permissão para exclusão.');

    const { error: storageError } = await serviceSupabase.storage
      .from(bucketName)
      .remove([storagePath]);
    if (storageError) throw storageError;

    const { data: eventId, error: deleteError } = await userSupabase.rpc(
      'delete_evidence_photo',
      { target_photo_id: photoId }
    );
    if (deleteError) throw deleteError;

    return sendJson(res, 200, { deleted: true, eventId });
  } catch (caughtError) {
    const message = caughtError instanceof Error
      ? caughtError.message
      : 'Não foi possível excluir a evidência.';
    return sendJson(res, 500, { error: message });
  }
}