import { LoaderCircle, Save, X } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../supabase';
import type { SurgeryRequest } from '../types';
import { usePersistedEvidence } from '../usePersistedEvidence';
import { notifyWhatsAppKitControl } from '../whatsappNotifications';
import { EvidencePhotoPicker } from './EvidencePhotoPicker';
import { WhatsAppDispatchDialog } from './WhatsAppDispatchDialog';

type KitControlModalProps = {
  request: SurgeryRequest;
  onClose: () => void;
  onChanged: () => void;
};

export function KitControlModal({ request, onClose, onChanged }: KitControlModalProps) {
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

  const answerDispatch = async (sendMessage: boolean) => {
    setDispatchOpen(false);
    if (!sendMessage) {
      setNotice('Fotos salvas sem disparo para o grupo.');
      return;
    }

    setSending(true);
    evidence.setError('');
    try {
      await notifyWhatsAppKitControl(request.id, photoPathsToSend);
      setNotice('Fotos salvas e mensagem enviada para Conferência de Kits.');
    } catch (caughtError) {
      evidence.setError(caughtError instanceof Error ? caughtError.message : 'As fotos foram salvas, mas a mensagem não foi enviada.');
    } finally {
      setSending(false);
    }
  };

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
          <button className="card-action-button" type="button" onClick={() => void savePhotos()} disabled={busy || evidence.loading}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            Salvar fotos
          </button>
        </footer>

        {dispatchOpen && (
          <WhatsAppDispatchDialog
            title={'Deseja enviar a mensagem no grupo de "Conferência de Kits"?'}
            actionLabel="O registro"
            description="As fotos já estão salvas. O envio da mensagem é opcional."
            withoutSendLabel="Não enviar"
            withSendLabel="Sim, enviar"
            onCancel={() => setDispatchOpen(false)}
            onConfirm={(sendMessage) => void answerDispatch(sendMessage)}
          />
        )}
      </section>
    </div>
  );
}
