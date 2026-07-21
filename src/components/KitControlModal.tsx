import { LoaderCircle, Save, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { SurgeryRequest } from '../types';
import { usePersistedEvidence } from '../usePersistedEvidence';
import { notifyWhatsAppKitControl } from '../whatsappNotifications';
import { EvidencePhotoPicker } from './EvidencePhotoPicker';
import { KitControlDispatchDialog, type KitControlDispatchMode } from './KitControlDispatchDialog';

type KitControlModalProps = {
  request: SurgeryRequest;
  onClose: () => void;
  onChanged: () => void;
  initialDispatchOpen?: boolean;
};

export function KitControlModal({ request, onClose, onChanged, initialDispatchOpen = false }: KitControlModalProps) {
  const evidence = usePersistedEvidence({
    requestId: request.id,
    taskId: null,
    photoType: 'kit_control',
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [photoPathsToSend, setPhotoPathsToSend] = useState<string[]>([]);
  const [initialDispatchHandled, setInitialDispatchHandled] = useState(false);

  const pendingPhotos = evidence.savedPhotos.filter((photo) => !photo.whatsapp_first_sent_at);
  const currentPhotos = evidence.savedPhotos.filter((photo) => photoPathsToSend.includes(photo.storage_path));

  const closeSafely = () => {
    if (evidence.hasPending && !window.confirm('Existem fotos que ainda não foram salvas. Deseja fechar e descartá-las?')) {
      return;
    }
    onClose();
  };

  const savePhotos = async () => {
    setNotice('');
    evidence.setError('');
    if (!evidence.hasPending) {
      evidence.setError(evidence.savedPhotos.length ? 'Adicione novas fotos antes de salvar.' : 'Adicione pelo menos uma foto.');
      return;
    }

    setSaving(true);
    try {
      const result = await evidence.savePending();
      if (result.failed || !result.uploadedPhotos.length) return;

      const { error } = await supabase.rpc('finalize_kit_control_evidence', {
        target_request_id: request.id,
      });
      if (error) throw error;

      setPhotoPathsToSend(result.uploadedPhotos.map((photo) => photo.storage_path));
      await evidence.reload();
      onChanged();
      setNotice('Fotos do Controle de Kits salvas com sucesso.');
      setDispatchOpen(true);
    } catch (caughtError) {
      evidence.setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar o Controle de Kits.');
    } finally {
      setSaving(false);
    }
  };

  const answerDispatch = async (mode: KitControlDispatchMode) => {
    setDispatchOpen(false);
    const selectedPhotos = mode === 'pending'
      ? pendingPhotos
      : mode === 'current'
        ? currentPhotos
        : evidence.savedPhotos;
    if (!selectedPhotos.length) {
      evidence.setError('Não há fotos disponíveis para a opção selecionada.');
      return;
    }

    setSending(true);
    evidence.setError('');
    setNotice('');
    try {
      const result = await notifyWhatsAppKitControl(
        request.id,
        selectedPhotos.map((photo) => photo.storage_path),
        mode
      );
      await evidence.reload();
      onChanged();
      if (result.failedMedia) {
        evidence.setError(`${result.sentMedia} foto(s) enviada(s) e ${result.failedMedia} com erro. As fotos com erro continuam pendentes.`);
      } else {
        setNotice(`${result.sentMedia} foto${result.sentMedia === 1 ? '' : 's'} enviada${result.sentMedia === 1 ? '' : 's'} para Conferência de Kits.`);
      }
    } catch (caughtError) {
      evidence.setError(caughtError instanceof Error ? caughtError.message : 'As fotos estão salvas, mas a mensagem não foi enviada.');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!initialDispatchOpen || initialDispatchHandled || evidence.loading) return;
    setInitialDispatchHandled(true);
    if (evidence.savedPhotos.length) setDispatchOpen(true);
    else evidence.setError('Ainda não existem fotos salvas para enviar.');
  }, [evidence.loading, evidence.savedPhotos.length, initialDispatchHandled, initialDispatchOpen]);

  const busy = evidence.uploading || saving || sending;

  return (
    <div className="modal-backdrop nested" role="presentation">
      <section className="evidence-modal kit-control-modal" role="dialog" aria-modal="true" aria-labelledby="kit-control-title">
        <header>
          <div>
            <p className="eyebrow">Controle de Kits</p>
            <h2 id="kit-control-title">Fotos da conferência</h2>
            <span>#{String(request.code).padStart(4, '0')} · {request.hospital}</span>
          </div>
          <button className="icon-button" type="button" onClick={closeSafely} aria-label="Fechar Controle de Kits" disabled={busy}>
            <X size={20} />
          </button>
        </header>

        {evidence.loading ? (
          <div className="evidence-loading"><LoaderCircle className="spin" size={22} /> Carregando fotos salvas...</div>
        ) : (
          <EvidencePhotoPicker
            photos={evidence.pickerPhotos}
            onAddFiles={evidence.addFiles}
            onRemove={(id) => void evidence.removePhoto(id)}
            emptyLabel="Nenhuma foto de Controle de Kits"
          />
        )}

        {notice && <p className="auth-message success">{notice}</p>}
        {evidence.error && <p className="auth-message error">{evidence.error}</p>}

        <footer className="evidence-draft-actions kit-control-actions">
          <button className="secondary-button" type="button" onClick={closeSafely} disabled={busy}>
            Fechar
          </button>
          <button className="evidence-save-button" type="button" onClick={() => setDispatchOpen(true)} disabled={busy || evidence.loading || !evidence.savedPhotos.length}>
            <Send size={17} />
            Enviar evidências
          </button>
          <button className="card-action-button" type="button" onClick={() => void savePhotos()} disabled={busy || evidence.loading || !evidence.hasPending}>
            {saving || evidence.uploading ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            Salvar fotos
          </button>
        </footer>

        {dispatchOpen && (
          <KitControlDispatchDialog
            pendingCount={pendingPhotos.length}
            currentCount={currentPhotos.length}
            totalCount={evidence.savedPhotos.length}
            onCancel={() => {
              setDispatchOpen(false);
              setNotice('Fotos mantidas sem novo disparo para o grupo.');
            }}
            onConfirm={(mode) => void answerDispatch(mode)}
          />
        )}
      </section>
    </div>
  );
}
