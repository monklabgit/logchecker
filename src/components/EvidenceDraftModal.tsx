import { Image as ImageIcon, LoaderCircle, PackageCheck, Save, X } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../supabase';
import type { SurgeryRequest, TransportTask } from '../types';
import { usePersistedEvidence } from '../usePersistedEvidence';
import { notifyWhatsAppOperation } from '../whatsappNotifications';
import { EvidencePhotoPicker } from './EvidencePhotoPicker';

type EvidenceDraftModalProps = {
  request: SurgeryRequest;
  task: TransportTask;
  onClose: () => void;
  onChanged: () => void;
};

export function EvidenceDraftModal({ request, task, onClose, onChanged }: EvidenceDraftModalProps) {
  const photoType = task.type === 'delivery' ? 'delivery' : 'pickup';
  const evidence = usePersistedEvidence({
    requestId: request.id,
    taskId: task.id,
    photoType,
  });
  const [completing, setCompleting] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [receivedCme, setReceivedCme] = useState(task.delivery_received_cme || '');
  const [receivedOpme, setReceivedOpme] = useState(task.delivery_received_opme || '');
  const [deliveryObservation, setDeliveryObservation] = useState(task.delivery_observation || '');
  const hasCmeMaterials = request.request_items.some((item) => item.section === 'CME');
  const hasOpmeMaterials = request.request_items.some((item) => item.section === 'OPME');

  const closeSafely = () => {
    if (
      evidence.hasPending &&
      !window.confirm('Existem fotos que ainda não foram salvas. Deseja fechar e descartá-las?')
    ) {
      return;
    }
    onClose();
  };

  const saveForLater = async () => {
    setSavedMessage('');
    if (!evidence.hasPending) {
      evidence.setError(evidence.savedPhotos.length ? 'Todas as fotos já estão salvas.' : 'Adicione pelo menos uma foto.');
      return;
    }

    const result = await evidence.savePending();
    if (!result.failed) {
      setSavedMessage('Fotos salvas. Você pode fechar e continuar em outro local.');
      onChanged();
    }
  };

  const completeTask = async () => {
    setSavedMessage('');
    setCompleting(true);
    evidence.setError('');

    try {
      if (task.type === 'delivery' && hasCmeMaterials && !receivedCme.trim()) {
        evidence.setError('Informe quem recebeu os materiais no CME.');
        return;
      }
      if (task.type === 'delivery' && hasOpmeMaterials && !receivedOpme.trim()) {
        evidence.setError('Informe quem recebeu os materiais no OPME.');
        return;
      }

      const result = await evidence.savePending();
      if (result.failed) return;
      if (!result.photos.length) {
        evidence.setError('Salve pelo menos uma foto para concluir esta etapa.');
        return;
      }

      const { error } = await supabase.rpc('complete_transport_task_with_evidence', {
        target_task_id: task.id,
        action_note: 'Fotos registradas',
        received_cme: task.type === 'delivery' ? receivedCme.trim() : '',
        received_opme: task.type === 'delivery' ? receivedOpme.trim() : '',
        delivery_observation: task.type === 'delivery' ? deliveryObservation.trim() : '',
      });
      if (error) throw error;

      const photoPaths = result.photos.map((photo) => photo.storage_path);
      notifyWhatsAppOperation(
        request.id,
        task.type === 'delivery' ? 'delivery_completed' : 'pickup_completed',
        photoPaths
      ).catch((notificationError) => {
        console.error('WhatsApp notification failed', notificationError);
      });

      onChanged();
      onClose();
    } catch (caughtError) {
      evidence.setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível concluir esta etapa.');
    } finally {
      setCompleting(false);
    }
  };

  const busy = evidence.uploading || completing;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">Evidências da rota</p>
            <h2 id="evidence-title">{task.type === 'delivery' ? 'Fotos da entrega' : 'Fotos da retirada'}</h2>
            <span>#{String(request.code).padStart(4, '0')} · {request.hospital}</span>
          </div>
          <button className="icon-button" type="button" onClick={closeSafely} aria-label="Fechar evidências" disabled={busy}>
            <X size={20} />
          </button>
        </header>

        {evidence.loading ? (
          <div className="evidence-loading"><LoaderCircle className="spin" size={22} /> Carregando fotos salvas...</div>
        ) : (
          <EvidencePhotoPicker photos={evidence.pickerPhotos} onAddFiles={evidence.addFiles} onRemove={(id) => void evidence.removePhoto(id)} />
        )}

        {task.type === 'delivery' && (
          <section className="delivery-receipt-fields" aria-labelledby="delivery-receipt-title">
            <div>
              <h3 id="delivery-receipt-title">Recebimento no hospital</h3>
              <p>Registre quem recebeu cada grupo de materiais.</p>
            </div>
            <div className="delivery-receipt-grid">
              <label>
                <span>Recebido no CME{hasCmeMaterials ? ' *' : ''}</span>
                <input
                  value={receivedCme}
                  onChange={(event) => setReceivedCme(event.target.value)}
                  placeholder="Nome de quem recebeu"
                  maxLength={160}
                  disabled={busy}
                />
              </label>
              <label>
                <span>Recebido no OPME{hasOpmeMaterials ? ' *' : ''}</span>
                <input
                  value={receivedOpme}
                  onChange={(event) => setReceivedOpme(event.target.value)}
                  placeholder="Nome de quem recebeu"
                  maxLength={160}
                  disabled={busy}
                />
              </label>
            </div>
            <label>
              <span>Observação da entrega</span>
              <textarea
                value={deliveryObservation}
                onChange={(event) => setDeliveryObservation(event.target.value)}
                placeholder="Informações adicionais sobre a entrega"
                rows={3}
                maxLength={1000}
                disabled={busy}
              />
            </label>
          </section>
        )}

        {savedMessage && <p className="auth-message success">{savedMessage}</p>}
        {evidence.error && <p className="auth-message error">{evidence.error}</p>}

        <footer className="evidence-draft-actions">
          <button className="secondary-button" type="button" onClick={closeSafely} disabled={busy}>
            Fechar e continuar depois
          </button>
          <button className="evidence-save-button" type="button" onClick={() => void saveForLater()} disabled={busy || evidence.loading}>
            {evidence.uploading ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            Salvar fotos
          </button>
          <button className="card-action-button" type="button" onClick={() => void completeTask()} disabled={busy || evidence.loading}>
            {completing ? <LoaderCircle className="spin" size={17} /> : task.type === 'delivery' ? <PackageCheck size={17} /> : <ImageIcon size={17} />}
            {task.type === 'delivery' ? 'Concluir entrega' : 'Concluir retirada'}
          </button>
        </footer>
      </section>
    </div>
  );
}
