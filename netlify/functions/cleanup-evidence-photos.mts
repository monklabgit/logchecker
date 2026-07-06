import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const bucketName = 'transport-evidence-photos';

const cleanupExpiredEvidencePhotos = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.' }),
    };
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: queryError.message }),
    };
  }

  const photos = expiredPhotos || [];
  if (!photos.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({ deleted: 0 }),
    };
  }

  const paths = photos.map((photo) => photo.storage_path);
  const { error: storageError } = await supabase.storage.from(bucketName).remove(paths);
  if (storageError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: storageError.message }),
    };
  }

  const { error: deleteError } = await supabase
    .from('transport_evidence_photos')
    .delete()
    .in(
      'id',
      photos.map((photo) => photo.id)
    );

  if (deleteError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: deleteError.message }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ deleted: photos.length }),
  };
};

export const handler = schedule('@daily', cleanupExpiredEvidencePhotos);
