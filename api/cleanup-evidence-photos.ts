import { createClient } from '@supabase/supabase-js';

const bucketName = 'transport-evidence-photos';

const sendJson = (res: any, status: number, payload: unknown) =>
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: 'SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: expiredPhotos, error: queryError } = await supabase
    .from('transport_evidence_photos')
    .select('id, storage_path')
    .lte('expires_at', new Date().toISOString())
    .limit(1000);

  if (queryError) {
    return sendJson(res, 500, { error: queryError.message });
  }

  const photos = expiredPhotos || [];
  if (!photos.length) {
    return sendJson(res, 200, { deleted: 0 });
  }

  const paths = photos.map((photo) => photo.storage_path);
  const { error: storageError } = await supabase.storage.from(bucketName).remove(paths);
  if (storageError) {
    return sendJson(res, 500, { error: storageError.message });
  }

  const { error: deleteError } = await supabase
    .from('transport_evidence_photos')
    .delete()
    .in(
      'id',
      photos.map((photo) => photo.id)
    );

  if (deleteError) {
    return sendJson(res, 500, { error: deleteError.message });
  }

  return sendJson(res, 200, { deleted: photos.length });
}
