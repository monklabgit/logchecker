import { useEffect, useState } from 'react';
import { CalendarDays, ChevronDown, Eye, History, Image as ImageIcon, LoaderCircle, PackageOpen, UserRound, X } from 'lucide-react';
import type { RoleAccess } from '../permissions';
import { supabase } from '../supabase';
import type { EvidencePhoto, Profile, SurgeryRequest, TransportEvent } from '../types';
import { notifyWhatsAppOperation } from '../whatsappNotifications';
import { EvidencePhotoPicker } from './EvidencePhotoPicker';

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
};

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const photoTypeLabels = {
  delivery: 'Entrega',
  pickup: 'Retirada',
  instrumentator_release: 'Liberação',
};

export function RequestDetails({ profile, access, request, onClose, onChanged }: RequestDetailsProps) {
  const [events, setEvents] = useState<TransportEvent[]>([]);
  const [signedPhotos, setSignedPhotos] = useState<Array<EvidencePhoto & { signedUrl: string }>>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [releasePhotos, setReleasePhotos] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [hospitalDetailsOpen, setHospitalDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    supabase
      .from('transport_events')
      .select('*, actor:profiles!transport_events_actor_id_fkey(id, full_name)')
      .eq('request_id', request.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        else setEvents((data || []) as TransportEvent[]);
        setLoadingEvents(false);
      });

    return () => {
      active = false;
    };
  }, [request.id]);

  useEffect(() => {
    let active = true;
    const photos = (request.transport_evidence_photos || []).filter((photo) => new Date(photo.expires_at) > new Date());

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
  }, [request.transport_evidence_photos]);

  const addReleasePhotos = (files: File[]) => {
    const selectedFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!selectedFiles.length) return;
    setError('');
    setReleasePhotos((current) => [
      ...current,
      ...selectedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeReleasePhoto = (photoId: string) => {
    setReleasePhotos((current) => {
      const photo = current.find((item) => item.id === photoId);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return current.filter((item) => item.id !== photoId);
    });
  };

  const releasePickup = async () => {
    if (!releasePhotos.length) {
      setError('Anexe pelo menos uma foto do material liberado para retirada.');
      return;
    }

    setReleasing(true);
    setError('');
    const uploadedPaths: string[] = [];

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Sessão expirada. Entre novamente para enviar a foto.');

      const evidenceRows = [];
      for (const photo of releasePhotos) {
        const extension = photo.file.name.split('.').pop() || 'jpg';
        const storagePath = `${request.id}/instrumentator_release/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('transport-evidence-photos')
          .upload(storagePath, photo.file, { contentType: photo.file.type || 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
        evidenceRows.push({
          request_id: request.id,
          task_id: null,
          photo_type: 'instrumentator_release',
          storage_path: storagePath,
          original_name: photo.file.name,
          mime_type: photo.file.type,
          uploaded_by: userData.user.id,
        });
      }

      const { error: evidenceError } = await supabase.from('transport_evidence_photos').insert(evidenceRows);

      if (evidenceError) {
        await supabase.storage.from('transport-evidence-photos').remove(uploadedPaths);
        throw evidenceError;
      }

      const { error: releaseError } = await supabase.rpc('release_request_for_pickup', {
        target_request_id: request.id,
      });
      if (releaseError) throw releaseError;

      notifyWhatsAppOperation(request.id, 'release_completed', uploadedPaths).catch((notificationError) => {
        console.error('WhatsApp notification failed', notificationError);
      });

      releasePhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setReleasePhotos([]);
      onChanged();
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível liberar para retirada.');
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
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar detalhes">
            <X size={20} />
          </button>
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
                      <strong>{item.quantity || '—'}</strong>
                      <span>{item.description}</span>
                      <small>{item.note}</small>
                    </div>
                  ))}
                </div>
              );
            })}
            {request.observation && <p className="surgery-observation"><strong>Observação da cirurgia:</strong> {request.observation}</p>}
          </section>

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
                          {event.from_status ? `${statusLabels[event.from_status]} → ` : ''}
                          {statusLabels[event.to_status]}
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

          {signedPhotos.length > 0 && (
            <section className="details-evidence">
              <h3><ImageIcon size={18} /> Evidências fotográficas</h3>
              <div className="evidence-grid">
                {signedPhotos.map((photo) => (
                  <a href={photo.signedUrl} target="_blank" rel="noreferrer" key={photo.id}>
                    <img src={photo.signedUrl} alt={`Foto de ${photoTypeLabels[photo.photo_type]}`} />
                    <span>{photoTypeLabels[photo.photo_type]}</span>
                    <time dateTime={photo.created_at}>{dateTimeFormatter.format(new Date(photo.created_at))}</time>
                  </a>
                ))}
              </div>
            </section>
          )}

          {error && <p className="auth-message error">{error}</p>}
        </div>

        {request.status === 'delivered' && ['admin', 'office', 'instrumentator'].includes(profile.role) && access.release_materials && (
          <footer className="details-footer release-footer">
            <EvidencePhotoPicker photos={releasePhotos} onAddFiles={addReleasePhotos} onRemove={removeReleasePhoto} />
            <div className="release-actions">
              <button className="card-action-button" type="button" onClick={() => void releasePickup()} disabled={releasing}>
                {releasing ? <LoaderCircle className="spin" size={17} /> : <PackageOpen size={17} />}
                Liberar para retirada
              </button>
            </div>
          </footer>
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
