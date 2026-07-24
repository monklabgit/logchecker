import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronDown, ClipboardCheck, Eye, History, Image as ImageIcon, LoaderCircle, PackageOpen, Printer, Save, Send, Trash2, UserRound, X } from 'lucide-react';
import type { RoleAccess } from '../permissions';
import { supabase } from '../supabase';
import type { EvidencePhoto, Profile, SurgeryRequest, TransportEvent } from '../types';
import { usePersistedEvidence } from '../usePersistedEvidence';
import { notifyWhatsAppOperation } from '../whatsappNotifications';
import { EvidencePhotoPicker } from './EvidencePhotoPicker';
import { KitControlModal } from './KitControlModal';
import { SurgeryRequestPrintModal } from './SurgeryRequestPrintModal';
import { WhatsAppDispatchDialog } from './WhatsAppDispatchDialog';

type RequestDetailsProps = {
  profile: Profile;
  access: RoleAccess;
  request: SurgeryRequest;
  onClose: () => void;
  onChanged: () => void;
};

const statusLabels = {
  available: 'Disponível',
  assigned: 'Assumida',
  in_route: 'Em rota',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const actionLabels = {
  created: 'Solicitação criada',
  claimed: 'Solicitação assumida',
  started: 'Rota iniciada',
  completed: 'Movimentação concluída',
  cancelled: 'Solicitação cancelada',
  evidence_deleted: 'Evidência excluída',
};

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const photoTypeLabels = {
  delivery: 'Entrega',
  pickup: 'Retirada',
  instrumentator_release: 'Liberação',
  kit_control: 'Controle de Kits',
};

export function RequestDetails({ access, request, onClose, onChanged }: RequestDetailsProps) {
  const [events, setEvents] = useState<TransportEvent[]>([]);
  const [signedPhotos, setSignedPhotos] = useState<Array<EvidencePhoto & { signedUrl: string }>>([]);
  const [evidenceDeleteTarget, setEvidenceDeleteTarget] = useState<(EvidencePhoto & { signedUrl: string }) | null>(null);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState('');
  const [evidenceNotice, setEvidenceNotice] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [hospitalDetailsOpen, setHospitalDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');
  const [releaseSavedMessage, setReleaseSavedMessage] = useState('');
  const [releaseObservation, setReleaseObservation] = useState(request.release_observation || '');
  const [dispatchConfirmationOpen, setDispatchConfirmationOpen] = useState(false);
  const [kitControlOpen, setKitControlOpen] = useState(false);
  const [kitControlDispatchOnOpen, setKitControlDispatchOnOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const releaseEvidence = usePersistedEvidence({
    requestId: request.id,
    taskId: null,
    photoType: 'instrumentator_release',
  });
  const kitControlPhotos = request.transport_evidence_photos.filter(
    (photo) => photo.photo_type === 'kit_control' && new Date(photo.expires_at) > new Date()
  );
  const kitControlPhotoCount = kitControlPhotos.length;
  const pendingKitControlPhotoCount = kitControlPhotos.filter((photo) => !photo.whatsapp_first_sent_at).length;
  const completedDelivery = request.transport_tasks
    .filter((task) => task.type === 'delivery' && task.status === 'completed')
    .sort((a, b) => (b.completed_at || b.created_at).localeCompare(a.completed_at || a.created_at))[0];

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    const { data, error: queryError } = await supabase
      .from('transport_events')
      .select('*, actor:profiles!transport_events_actor_id_fkey(id, full_name)')
      .eq('request_id', request.id)
      .order('created_at', { ascending: false });

    if (queryError) setError(queryError.message);
    else setEvents((data || []) as TransportEvent[]);
    setLoadingEvents(false);
  }, [request.id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!access.view_evidence) {
      setSignedPhotos([]);
      return undefined;
    }

    let active = true;
    const photos = (request.transport_evidence_photos || []).filter((photo) => photo.finalized_at && new Date(photo.expires_at) > new Date());

    Promise.all(
      photos.map(async (photo) => {
        const { data } = await supabase.storage.from('transport-evidence-photos').createSignedUrl(photo.storage_path, 60 * 10);
        return data?.signedUrl ? { ...photo, signedUrl: data.signedUrl } : null;
      })
    ).then((items) => {
      if (active) setSignedPhotos(items.filter(Boolean) as Array<EvidencePhoto & { signedUrl: string }>);
    });

    return () => {
      active = false;
    };
  }, [access.view_evidence, request.transport_evidence_photos]);

  const deleteEvidencePhoto = async () => {
    if (!evidenceDeleteTarget) return;
    setDeletingEvidenceId(evidenceDeleteTarget.id);
    setError('');
    setEvidenceNotice('');

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Sessão ausente. Entre novamente para excluir a evidência.');

      const response = await fetch('/api/delete-evidence-photo', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ photoId: evidenceDeleteTarget.id }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível excluir a evidência.');

      setSignedPhotos((current) => current.filter((photo) => photo.id !== evidenceDeleteTarget.id));
      setEvidenceDeleteTarget(null);
      setEvidenceNotice('Foto excluída definitivamente. A ação foi registrada no histórico.');
      await loadEvents();
      onChanged();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível excluir a evidência.');
    } finally {
      setDeletingEvidenceId('');
    }
  };

  const closeSafely = () => {
    if (
      releaseEvidence.hasPending &&
      !window.confirm('Existem fotos que ainda não foram salvas. Deseja fechar e descartá-las?')
    ) {
      return;
    }
    onClose();
  };

  const saveReleasePhotos = async () => {
    setReleaseSavedMessage('');
    if (!releaseEvidence.hasPending) {
      releaseEvidence.setError(releaseEvidence.savedPhotos.length ? 'Todas as fotos já estão salvas.' : 'Adicione pelo menos uma foto.');
      return;
    }

    const result = await releaseEvidence.savePending();
    if (!result.failed) {
      setReleaseSavedMessage('Fotos salvas. Você pode fechar e continuar depois.');
      onChanged();
    }
  };

  const requestRelease = () => {
    releaseEvidence.setError('');
    if (!releaseEvidence.hasPending && !releaseEvidence.savedPhotos.length) {
      releaseEvidence.setError('Salve pelo menos uma foto do material liberado para retirada.');
      return;
    }
    setDispatchConfirmationOpen(true);
  };

  const releasePickup = async (sendWhatsApp: boolean) => {
    setDispatchConfirmationOpen(false);
    setReleasing(true);
    setReleaseSavedMessage('');
    releaseEvidence.setError('');

    try {
      const result = await releaseEvidence.savePending();
      if (result.failed) return;
      if (!result.photos.length) {
        releaseEvidence.setError('Salve pelo menos uma foto do material liberado para retirada.');
        return;
      }

      const { error: releaseError } = await supabase.rpc('release_request_for_pickup_with_evidence', {
        target_request_id: request.id,
        action_observation: releaseObservation.trim(),
      });
      if (releaseError) throw releaseError;

      if (sendWhatsApp) {
        notifyWhatsAppOperation(
          request.id,
          'release_completed',
          result.photos.map((photo) => photo.storage_path)
        ).catch((notificationError) => {
          console.error('WhatsApp notification failed', notificationError);
        });
      }

      onChanged();
      onClose();
    } catch (caughtError) {
      releaseEvidence.setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível liberar para retirada.');
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="details-modal" role="dialog" aria-modal="true" aria-labelledby="details-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="details-header">
          <div>
            <span className="request-code">#{String(request.code).padStart(4, '0')}</span>
            <div className="details-title-line">
              <h2 id="details-title">{request.hospital}</h2>
              {request.hospital_record && (
                <button className="hospital-view-button" type="button" onClick={() => setHospitalDetailsOpen(true)} aria-label="Ver detalhes do hospital">
                  <Eye size={17} />
                </button>
              )}
            </div>
            <p>{request.procedure || 'Procedimento não informado'}</p>
          </div>
          <div className="details-header-actions">
            <button className="icon-button" type="button" onClick={() => setPrintOpen(true)} aria-label="Imprimir solicitação" title="Imprimir solicitação">
              <Printer size={19} />
            </button>
            <button className="icon-button" type="button" onClick={closeSafely} aria-label="Fechar detalhes">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="details-body">
          <section className="details-summary">
            <h3>Dados da solicitação</h3>
            <dl className="compact-details-list">
              <div>
                <dt><UserRound size={15} /> Paciente</dt>
                <dd>{request.patient || 'Não informado'}</dd>
              </div>
              <div>
                <dt><UserRound size={15} /> Cirurgião</dt>
                <dd>{request.surgeon || 'Não informado'}</dd>
              </div>
              <div>
                <dt>Convênio</dt>
                <dd>{request.insurance || 'Não informado'}</dd>
              </div>
              <div>
                <dt><CalendarDays size={15} /> Cirurgia</dt>
                <dd>
                  {request.surgery_date
                    ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${request.surgery_date}T12:00:00`))
                    : 'Não informada'}
                  {request.surgery_time ? ` · ${request.surgery_time.slice(0, 5)}` : ''}
                </dd>
              </div>
            </dl>
          </section>

          <section className="details-materials">
            <h3><PackageOpen size={18} /> Materiais</h3>
            {(['CME', 'OPME', 'OTHER'] as const).map((section) => {
              const sectionItems = request.request_items.filter((item) => item.section === section);
              if (!sectionItems.length) return null;
              return (
                <div className="material-section" key={section}>
                  <h4>{section === 'OTHER' ? 'OUTROS' : section}</h4>
                  {sectionItems.map((item) => (
                    <div className="material-line" key={item.id}>
                      <strong>{item.quantity || '-'}</strong>
                      <span>{item.description}</span>
                      <small>{item.note}</small>
                    </div>
                  ))}
                </div>
              );
            })}
            {request.observation && <p className="surgery-observation"><strong>Observação da cirurgia:</strong> {request.observation}</p>}
          </section>

          {access.create_requests && request.status !== 'cancelled' && (
            <section className="details-kit-control">
              <div>
                <h3><ClipboardCheck size={18} /> Controle de Kits</h3>
                <p>
                  {kitControlPhotoCount
                    ? `${kitControlPhotoCount} foto${kitControlPhotoCount === 1 ? '' : 's'} · ${pendingKitControlPhotoCount} não enviada${pendingKitControlPhotoCount === 1 ? '' : 's'}`
                    : 'Nenhuma foto registrada'}
                </p>
              </div>
              <div className="details-kit-control-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setKitControlDispatchOnOpen(false);
                    setKitControlOpen(true);
                  }}
                >
                  <ImageIcon size={17} />
                  Anexar fotos
                </button>
                <button
                  className="card-action-button"
                  type="button"
                  disabled={!kitControlPhotoCount}
                  onClick={() => {
                    setKitControlDispatchOnOpen(true);
                    setKitControlOpen(true);
                  }}
                >
                  <Send size={17} />
                  Enviar evidências
                </button>
              </div>
            </section>
          )}

          {completedDelivery && (completedDelivery.delivery_received_cme || completedDelivery.delivery_received_opme || completedDelivery.delivery_observation) && (
            <section className="details-delivery-receipt">
              <h3><PackageOpen size={18} /> Dados da entrega</h3>
              <dl className="compact-details-list">
                <div>
                  <dt>Recebido no CME</dt>
                  <dd>{completedDelivery.delivery_received_cme || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Recebido no OPME</dt>
                  <dd>{completedDelivery.delivery_received_opme || 'Não informado'}</dd>
                </div>
                {completedDelivery.delivery_observation && (
                  <div>
                    <dt>Observação da entrega</dt>
                    <dd>{completedDelivery.delivery_observation}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {request.release_observation && (
            <section className="details-delivery-receipt">
              <h3><PackageOpen size={18} /> Dados da liberação</h3>
              <dl className="compact-details-list">
                <div>
                  <dt>Observação da liberação</dt>
                  <dd>{request.release_observation}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="details-history">
            <button className="details-history-toggle" type="button" onClick={() => setHistoryOpen((current) => !current)} aria-expanded={historyOpen}>
              <span><History size={18} /> Histórico</span>
              <span>
                {loadingEvents ? 'Carregando' : `${events.length} evento${events.length === 1 ? '' : 's'}`}
                {loadingEvents ? <LoaderCircle className="spin" size={17} /> : <ChevronDown className={historyOpen ? 'expanded' : ''} size={18} />}
              </span>
            </button>
            {historyOpen && !loadingEvents && (
              <ol>
                  {events.map((event) => (
                    <li key={event.id}>
                      <span className="timeline-dot" />
                      <div>
                        <strong className="history-action">
                          <span>{actionLabels[event.action]}</span>
                          <em>por</em>
                          <span>{event.actor?.full_name || (event.actor_id ? 'Usuário sem nome' : 'Usuário não registrado')}</span>
                        </strong>
                        <p>
                          {event.action === 'evidence_deleted'
                            ? event.note
                            : `${event.from_status ? `${statusLabels[event.from_status]} -> ` : ''}${statusLabels[event.to_status]}`}
                        </p>
                        <span className="history-actor">
                          {event.actor?.full_name || (event.actor_id ? 'Usuário sem nome' : 'Usuário não registrado')}
                        </span>
                        <time dateTime={event.created_at}>{dateTimeFormatter.format(new Date(event.created_at))}</time>
                      </div>
                    </li>
                  ))}
                </ol>
            )}
          </section>

          {access.view_evidence && signedPhotos.length > 0 && (
            <section className="details-evidence">
              <h3><ImageIcon size={18} /> Evidências fotográficas</h3>
              <div className="evidence-grid">
                {signedPhotos.map((photo) => (
                  <article className="evidence-grid-item" key={photo.id}>
                    <a href={photo.signedUrl} target="_blank" rel="noreferrer">
                      <img src={photo.signedUrl} alt={`Foto de ${photoTypeLabels[photo.photo_type]}`} />
                      <span>{photoTypeLabels[photo.photo_type]}</span>
                      <time dateTime={photo.created_at}>{dateTimeFormatter.format(new Date(photo.created_at))}</time>
                    </a>
                    {access.delete_evidence && (
                      <button
                        className="evidence-delete-button"
                        type="button"
                        onClick={() => setEvidenceDeleteTarget(photo)}
                        disabled={deletingEvidenceId === photo.id}
                        aria-label={`Excluir foto de ${photoTypeLabels[photo.photo_type]}`}
                        title="Excluir evidência"
                      >
                        {deletingEvidenceId === photo.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {evidenceNotice && <p className="auth-message success">{evidenceNotice}</p>}
          {error && <p className="auth-message error">{error}</p>}
        </div>

        {request.status === 'delivered' && access.release_materials && (
          <footer className="details-footer release-footer">
            <label className="release-observation-field">
              <span>Observação da liberação (opcional)</span>
              <textarea
                value={releaseObservation}
                onChange={(event) => setReleaseObservation(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Ex.: material faltante, danificado ou outra ocorrência"
                disabled={releasing}
              />
            </label>
            {releaseEvidence.loading ? (
              <div className="evidence-loading"><LoaderCircle className="spin" size={20} /> Carregando fotos salvas...</div>
            ) : (
              <EvidencePhotoPicker
                photos={releaseEvidence.pickerPhotos}
                onAddFiles={releaseEvidence.addFiles}
                onRemove={(id) => void releaseEvidence.removePhoto(id)}
              />
            )}
            {releaseSavedMessage && <p className="auth-message success">{releaseSavedMessage}</p>}
            {releaseEvidence.error && <p className="auth-message error">{releaseEvidence.error}</p>}
            <div className="release-actions">
              <button
                className="evidence-save-button"
                type="button"
                onClick={() => void saveReleasePhotos()}
                disabled={releasing || releaseEvidence.uploading || releaseEvidence.loading}
              >
                {releaseEvidence.uploading ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
                Salvar fotos
              </button>
              <button
                className="card-action-button"
                type="button"
                onClick={requestRelease}
                disabled={releasing || releaseEvidence.uploading || releaseEvidence.loading}
              >
                {releasing ? <LoaderCircle className="spin" size={17} /> : <PackageOpen size={17} />}
                Liberar para retirada
              </button>
            </div>
          </footer>
        )}

        {evidenceDeleteTarget && (
          <div
            className="modal-backdrop nested"
            role="presentation"
            onMouseDown={(event) => event.target === event.currentTarget && !deletingEvidenceId && setEvidenceDeleteTarget(null)}
          >
            <section className="action-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-evidence-title">
              <header>
                <div>
                  <p className="eyebrow">Excluir evidência</p>
                  <h2 id="delete-evidence-title">Foto de {photoTypeLabels[evidenceDeleteTarget.photo_type]}</h2>
                  <span>Esta ação será registrada no histórico da solicitação.</span>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setEvidenceDeleteTarget(null)}
                  disabled={Boolean(deletingEvidenceId)}
                  aria-label="Fechar confirmação"
                >
                  <X size={20} />
                </button>
              </header>

              <div className="danger-modal-copy">
                <strong>A foto será excluída definitivamente do sistema.</strong>
                <p>O arquivo será removido do Storage e não poderá ser recuperado. O histórico manterá quem realizou a exclusão e quando ela aconteceu.</p>
              </div>

              <footer>
                <button className="card-detail-button" type="button" onClick={() => setEvidenceDeleteTarget(null)} disabled={Boolean(deletingEvidenceId)}>
                  Cancelar
                </button>
                <button className="danger-action-button" type="button" onClick={() => void deleteEvidencePhoto()} disabled={Boolean(deletingEvidenceId)}>
                  {deletingEvidenceId ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                  Excluir definitivamente
                </button>
              </footer>
            </section>
          </div>
        )}

        {printOpen && <SurgeryRequestPrintModal request={request} onClose={() => setPrintOpen(false)} />}

        {kitControlOpen && (
          <KitControlModal
            request={request}
            initialDispatchOpen={kitControlDispatchOnOpen}
            onClose={() => {
              setKitControlOpen(false);
              setKitControlDispatchOnOpen(false);
            }}
            onChanged={onChanged}
          />
        )}

        {dispatchConfirmationOpen && (
          <WhatsAppDispatchDialog
            actionLabel="A liberação para retirada"
            onCancel={() => setDispatchConfirmationOpen(false)}
            onConfirm={(sendMessage) => void releasePickup(sendMessage)}
          />
        )}

        {hospitalDetailsOpen && request.hospital_record && (
          <div className="modal-backdrop nested" role="presentation">
            <section className="hospital-details-modal" role="dialog" aria-modal="true" aria-labelledby="hospital-details-title">
              <header>
                <div>
                  <p className="eyebrow">Hospital</p>
                  <h2 id="hospital-details-title">{request.hospital_record.name}</h2>
                </div>
                <button className="icon-button" type="button" onClick={() => setHospitalDetailsOpen(false)} aria-label="Fechar detalhes do hospital">
                  <X size={20} />
                </button>
              </header>
              <dl>
                <div>
                  <dt>Endereço</dt>
                  <dd>{request.hospital_record.address || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Busca no mapa</dt>
                  <dd>{request.hospital_record.maps_query || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Acesso / carga e descarga</dt>
                  <dd>{request.hospital_record.loading_access || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>CME</dt>
                  <dd>{request.hospital_record.cme_location || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>OPME</dt>
                  <dd>{request.hospital_record.opme_location || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Centro cirúrgico</dt>
                  <dd>{request.hospital_record.surgical_center_location || 'Não informado'}</dd>
                </div>
                <div>
                  <dt>Dicas / observações</dt>
                  <dd>{request.hospital_record.notes || 'Não informado'}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

