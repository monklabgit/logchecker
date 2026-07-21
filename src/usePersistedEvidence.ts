import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { optimizeEvidencePhoto } from './imageOptimization';
import { supabase } from './supabase';
import type { EvidencePhoto, EvidencePhotoType } from './types';

export type EvidencePickerPhoto = {
  id: string;
  previewUrl: string | null;
  state: 'pending' | 'uploading' | 'saved' | 'error';
  removable: boolean;
  statusLabel?: string;
};

type LocalPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  state: 'pending' | 'uploading' | 'error';
};

export type SignedEvidencePhoto = EvidencePhoto & { signedUrl: string | null };

type UsePersistedEvidenceOptions = {
  requestId: string;
  taskId: string | null;
  photoType: EvidencePhotoType;
};

const sentAtFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const signPhoto = async (photo: EvidencePhoto): Promise<SignedEvidencePhoto> => {
  const { data, error } = await supabase.storage
    .from('transport-evidence-photos')
    .createSignedUrl(photo.storage_path, 60 * 30);
  return { ...photo, signedUrl: error ? null : data?.signedUrl || null };
};

export function usePersistedEvidence({ requestId, taskId, photoType }: UsePersistedEvidenceOptions) {
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [savedPhotos, setSavedPhotos] = useState<SignedEvidencePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const localPhotosRef = useRef<LocalPhoto[]>([]);

  useEffect(() => {
    localPhotosRef.current = localPhotos;
  }, [localPhotos]);

  useEffect(
    () => () => {
      localPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    },
    []
  );

  const loadSavedPhotos = useCallback(async () => {
    setLoading(true);
    setError('');

    let query = supabase
      .from('transport_evidence_photos')
      .select('*')
      .eq('request_id', requestId)
      .eq('photo_type', photoType)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    query = taskId ? query.eq('task_id', taskId) : query.is('task_id', null);
    const { data, error: queryError } = await query;

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return [];
    }

    try {
      const signed = await Promise.all(((data || []) as EvidencePhoto[]).map(signPhoto));
      setSavedPhotos(signed);
      setLoading(false);
      return signed;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar as fotos salvas.');
      setLoading(false);
      return [];
    }
  }, [photoType, requestId, taskId]);

  useEffect(() => {
    void loadSavedPhotos();
  }, [loadSavedPhotos]);

  const addFiles = useCallback(async (files: File[]) => {
    const selectedFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!selectedFiles.length) return;
    setError('');

    for (const selectedFile of selectedFiles) {
      try {
        const file = await optimizeEvidencePhoto(selectedFile);
        setLocalPhotos((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            file,
            previewUrl: URL.createObjectURL(file),
            state: 'pending',
          },
        ]);
      } catch {
        setError('Não foi possível preparar uma das imagens selecionadas.');
      }
    }
  }, []);

  const removePhoto = useCallback(async (photoId: string) => {
    const localPhoto = localPhotosRef.current.find((photo) => photo.id === photoId);
    if (localPhoto) {
      URL.revokeObjectURL(localPhoto.previewUrl);
      setLocalPhotos((current) => current.filter((photo) => photo.id !== photoId));
      return;
    }

    const savedPhoto = savedPhotos.find((photo) => photo.id === photoId);
    if (!savedPhoto || savedPhoto.finalized_at) return;

    setError('');
    const { error: storageError } = await supabase.storage
      .from('transport-evidence-photos')
      .remove([savedPhoto.storage_path]);
    if (storageError) {
      setError(storageError.message);
      return;
    }

    const { error: deleteError } = await supabase
      .from('transport_evidence_photos')
      .delete()
      .eq('id', savedPhoto.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSavedPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }, [savedPhotos]);

  const savePending = useCallback(async () => {
    const photosToUpload = localPhotosRef.current.filter((photo) => photo.state !== 'uploading');
    if (!photosToUpload.length) return { photos: savedPhotos, uploadedPhotos: [], failed: false };

    setUploading(true);
    setError('');
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setUploading(false);
      setError('Sessão expirada. Entre novamente para enviar as fotos.');
      return { photos: savedPhotos, uploadedPhotos: [], failed: true };
    }

    const nextSaved = [...savedPhotos];
    const uploadedPhotos: SignedEvidencePhoto[] = [];
    let failed = false;

    for (const photo of photosToUpload) {
      setLocalPhotos((current) => current.map((item) => (item.id === photo.id ? { ...item, state: 'uploading' } : item)));
      const extension = photo.file.name.split('.').pop() || 'jpg';
      const storagePath = `${requestId}/${photoType}/${crypto.randomUUID()}.${extension}`;

      try {
        const { error: uploadError } = await supabase.storage
          .from('transport-evidence-photos')
          .upload(storagePath, photo.file, { contentType: photo.file.type || 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;

        const { data: inserted, error: insertError } = await supabase
          .from('transport_evidence_photos')
          .insert({
            request_id: requestId,
            task_id: taskId,
            photo_type: photoType,
            storage_path: storagePath,
            original_name: photo.file.name,
            mime_type: photo.file.type || 'image/jpeg',
            uploaded_by: userData.user.id,
            finalized_at: null,
          })
          .select('*')
          .single();

        if (insertError || !inserted) {
          await supabase.storage.from('transport-evidence-photos').remove([storagePath]);
          throw insertError || new Error('Não foi possível registrar a foto.');
        }

        const signed = await signPhoto(inserted as EvidencePhoto);
        nextSaved.push(signed);
        uploadedPhotos.push(signed);
        setSavedPhotos((current) => [...current, signed]);
        URL.revokeObjectURL(photo.previewUrl);
        setLocalPhotos((current) => current.filter((item) => item.id !== photo.id));
      } catch (caughtError) {
        failed = true;
        setLocalPhotos((current) => current.map((item) => (item.id === photo.id ? { ...item, state: 'error' } : item)));
        setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar uma das fotos.');
      }
    }

    setUploading(false);
    return { photos: nextSaved, uploadedPhotos, failed };
  }, [photoType, requestId, savedPhotos, taskId]);

  const pickerPhotos = useMemo<EvidencePickerPhoto[]>(
    () => [
      ...savedPhotos.map((photo) => ({
        id: photo.id,
        previewUrl: photo.signedUrl,
        state: 'saved' as const,
        removable: !photo.finalized_at,
        statusLabel: photoType === 'kit_control'
          ? photo.whatsapp_last_sent_at
            ? `Enviada ${sentAtFormatter.format(new Date(photo.whatsapp_last_sent_at))}`
            : 'Não enviada'
          : 'Salva',
      })),
      ...localPhotos.map((photo) => ({
        id: photo.id,
        previewUrl: photo.previewUrl,
        state: photo.state,
        removable: photo.state !== 'uploading',
      })),
    ],
    [localPhotos, photoType, savedPhotos]
  );

  return {
    pickerPhotos,
    savedPhotos,
    hasPending: localPhotos.length > 0,
    loading,
    uploading,
    error,
    setError,
    addFiles,
    removePhoto,
    savePending,
    reload: loadSavedPhotos,
  };
}
