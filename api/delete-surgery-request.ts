import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const bucketName = 'transport-evidence-photos';
const supabaseProjectUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const sendJson = (res: any, status: number, payload: unknown) =>
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));

const bodyFromRequest = (req: any) => {
  if (req.body && typeof req.body === 'object') return req.body as { requestId?: string };
  if (typeof req.body === 'string') return JSON.parse(req.body) as { requestId?: string };
  return {};
};

const listRequestFiles = async (supabase: SupabaseClient, requestId: string) => {
  const paths: string[] = [];

  const readPrefix = async (prefix: string): Promise<void> => {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucketName).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;

      const entries = data || [];
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id) paths.push(path);
        else await readPrefix(path);
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
  };

  await readPrefix(requestId);
  return paths;
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
    return sendJson(res, 401, { error: 'Sessão ausente. Entre novamente para excluir a solicitação.' });
  }

  let requestId = '';
  try {
    requestId = String(bodyFromRequest(req).requestId || '').trim();
  } catch {
    return sendJson(res, 400, { error: 'Corpo da requisição inválido.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return sendJson(res, 400, { error: 'Solicitação inválida.' });
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
    const storagePaths = await listRequestFiles(serviceSupabase, requestId);
    const { error: deleteError } = await userSupabase.rpc('delete_surgery_request_permanently', {
      target_request_id: requestId,
    });
    if (deleteError) throw deleteError;

    for (let offset = 0; offset < storagePaths.length; offset += 100) {
      const { error: storageError } = await serviceSupabase.storage
        .from(bucketName)
        .remove(storagePaths.slice(offset, offset + 100));
      if (storageError) throw storageError;
    }

    return sendJson(res, 200, { deleted: true, deletedEvidenceFiles: storagePaths.length });
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Não foi possível excluir a solicitação.';
    return sendJson(res, 500, { error: message });
  }
}
