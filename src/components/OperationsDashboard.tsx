import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Box,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  CircleDot,
  Eye,
  Image as ImageIcon,
  LoaderCircle,
  MapPin,
  Navigation,
  PackageCheck,
  Play,
  RefreshCw,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import type { RoleAccess } from '../permissions';
import { supabase } from '../supabase';
import type { EvidencePhotoType, Profile, RequestStatus, SurgeryRequest, TransportTask } from '../types';
import { optimizeEvidencePhoto } from '../imageOptimization';
import { notifyWhatsAppOperation } from '../whatsappNotifications';
import { EvidencePhotoPicker } from './EvidencePhotoPicker';
import { RequestDetails } from './RequestDetails';

type OperationsDashboardProps = {
  profile: Profile;
  access: RoleAccess;
  highlightedRequestId?: string;
  refreshKey?: number;
};

const columns: Array<{ status: RequestStatus; label: string; tone: string; icon: typeof Box }> = [
  { status: 'ready_delivery', label: 'Disponível para entrega', tone: 'blue', icon: Box },
  { status: 'delivery_in_route', label: 'Em rota de entrega', tone: 'amber', icon: Truck },
  { status: 'delivered', label: 'Entregue', tone: 'green', icon: CheckCircle2 },
  { status: 'ready_pickup', label: 'Disponível para retirada', tone: 'purple', icon: PackageCheck },
  { status: 'pickup_in_route', label: 'Em rota de retirada', tone: 'amber', icon: Truck },
  { status: 'returned_stock', label: 'Retornado ao estoque', tone: 'slate', icon: PackageCheck },
];

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const getOpenTask = (request: SurgeryRequest) =>
  request.transport_tasks
    .filter((task) => !['completed', 'cancelled'].includes(task.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

const actionForTask = (task: TransportTask | null, profile: Profile, access: RoleAccess) => {
  if (!task) return null;
  if (task.status === 'available' && ['driver', 'admin'].includes(profile.role) && access.claim_routes) {
    return { action: 'claim', label: 'Assumir', icon: CircleDot };
  }
  if (task.status === 'assigned' && (task.assigned_driver_id === profile.id || profile.role === 'admin') && access.claim_routes) {
    return { action: 'start', label: 'Iniciar rota', icon: Play };
  }
  if (task.status === 'in_route' && (task.assigned_driver_id === profile.id || profile.role === 'admin')) {
    if (task.type === 'delivery' && !access.complete_delivery) return null;
    if (task.type === 'pickup' && !access.complete_pickup) return null;
    return {
      action: 'complete',
      label: task.type === 'delivery' ? 'Entregar' : 'Retornar',
      icon: PackageCheck,
    };
  }
  return null;
};

const routeQueryForTask = (request: SurgeryRequest, task: TransportTask | null) => {
  if (!task) return '';
  const hospitalQuery =
    request.hospital_record?.maps_query ||
    request.hospital_record?.address ||
    request.hospital ||
    task.destination_label;

  if (task.type === 'delivery') return hospitalQuery;
  if (task.status === 'assigned') return hospitalQuery;
  return task.destination_label || hospitalQuery;
};

const openNavigation = (provider: 'waze' | 'maps', query: string) => {
  const encoded = encodeURIComponent(query);
  const url =
    provider === 'waze'
      ? `https://waze.com/ul?q=${encoded}&navigate=yes`
      : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;

  window.open(url, '_blank', 'noopener,noreferrer');
};

export function OperationsDashboard({ profile, access, highlightedRequestId, refreshKey = 0 }: OperationsDashboardProps) {
  const [requests, setRequests] = useState<SurgeryRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<SurgeryRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actingTaskId, setActingTaskId] = useState('');
  const [photoPrompt, setPhotoPrompt] = useState<{
    request: SurgeryRequest;
    task: TransportTask;
    action: string;
    photoType: EvidencePhotoType;
  } | null>(null);
  const [evidencePhotos, setEvidencePhotos] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [collapsedColumns, setCollapsedColumns] = useState<Set<RequestStatus>>(
    () => new Set(columns.map((column) => column.status))
  );
  const [navigationTarget, setNavigationTarget] = useState<{ title: string; query: string } | null>(null);

  const loadRequests = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');

    const { data, error: queryError } = await supabase
      .from('surgery_requests')
      .select(
        '*, hospital_record:hospitals(*), request_items(*), transport_tasks(*, assigned_driver:profiles!transport_tasks_assigned_driver_id_fkey(id, full_name)), transport_evidence_photos(*)'
      )
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
    } else {
      const nextRequests = (data || []) as unknown as SurgeryRequest[];
      setRequests(nextRequests);
      if (highlightedRequestId) {
        const highlightedRequest = nextRequests.find((request) => request.id === highlightedRequestId) || null;
        if (highlightedRequest) {
          setCollapsedColumns((currentColumns) => {
            const nextColumns = new Set(currentColumns);
            nextColumns.delete(highlightedRequest.status);
            return nextColumns;
          });
          setExpandedCards((currentCards) => {
            const nextCards = new Set(currentCards);
            nextCards.add(highlightedRequest.id);
            return nextCards;
          });
        }
      }
      setSelectedRequest((current) => {
        if (current) return nextRequests.find((request) => request.id === current.id) || null;
        return null;
      });
    }

    setLoading(false);
    setRefreshing(false);
  }, [highlightedRequestId, refreshKey]);

  useEffect(() => {
    void loadRequests();

    const channel = supabase
      .channel('operations-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surgery_requests' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_tasks' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_evidence_photos' }, () => void loadRequests(true))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadRequests]);

  useEffect(() => {
    if (!highlightedRequestId || !requests.some((request) => request.id === highlightedRequestId)) return;
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-request-id="${highlightedRequestId}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }, [highlightedRequestId, requests]);

  const groupedRequests = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [column.status, requests.filter((request) => request.status === column.status)])
      ) as Record<RequestStatus, SurgeryRequest[]>,
    [requests]
  );

  const runTaskAction = async (task: TransportTask, action: string) => {
    setActingTaskId(task.id);
    setError('');
    const { error: actionError } = await supabase.rpc('advance_transport_task', {
      target_task_id: task.id,
      task_action: action,
      action_note: '',
    });

    if (actionError) setError(actionError.message);
    await loadRequests(true);
    setActingTaskId('');
  };

  const startTaskAction = (request: SurgeryRequest, task: TransportTask, action: string) => {
    if (action === 'complete') {
      evidencePhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setEvidencePhotos([]);
      setEvidenceError('');
      setPhotoPrompt({
        request,
        task,
        action,
        photoType: task.type === 'delivery' ? 'delivery' : 'pickup',
      });
      return;
    }

    void runTaskAction(task, action);
  };

  const addEvidencePhotos = async (files: File[]) => {
    const selectedFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!selectedFiles.length) return;
    setEvidenceError('');
    const optimizedFiles = await Promise.all(selectedFiles.map((file) => optimizeEvidencePhoto(file)));
    setEvidencePhotos((current) => [
      ...current,
      ...optimizedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const closePhotoPrompt = () => {
    evidencePhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setEvidencePhotos([]);
    setEvidenceError('');
    setPhotoPrompt(null);
  };

  const removeEvidencePhoto = (photoId: string) => {
    setEvidencePhotos((current) => {
      const photo = current.find((item) => item.id === photoId);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return current.filter((item) => item.id !== photoId);
    });
  };

  const uploadEvidenceAndRunAction = async () => {
    if (!photoPrompt) return;
    if (!evidencePhotos.length) {
      setEvidenceError('Anexe pelo menos uma foto para concluir esta etapa.');
      return;
    }

    setEvidenceUploading(true);
    setEvidenceError('');
    setActingTaskId(photoPrompt.task.id);
    const uploadedPaths: string[] = [];

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Sessão expirada. Entre novamente para enviar a foto.');

      const evidenceRows = [];
      for (const photo of evidencePhotos) {
        const extension = photo.file.name.split('.').pop() || 'jpg';
        const storagePath = `${photoPrompt.request.id}/${photoPrompt.photoType}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('transport-evidence-photos')
          .upload(storagePath, photo.file, { contentType: photo.file.type || 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
        evidenceRows.push({
          request_id: photoPrompt.request.id,
          task_id: photoPrompt.task.id,
          photo_type: photoPrompt.photoType,
          storage_path: storagePath,
          original_name: photo.file.name,
          mime_type: photo.file.type,
          uploaded_by: userData.user.id,
        });
      }

      const { error: insertError } = await supabase.from('transport_evidence_photos').insert(evidenceRows);

      if (insertError) {
        await supabase.storage.from('transport-evidence-photos').remove(uploadedPaths);
        throw insertError;
      }

      const { error: actionError } = await supabase.rpc('advance_transport_task', {
        target_task_id: photoPrompt.task.id,
        task_action: photoPrompt.action,
        action_note: 'Foto registrada',
      });
      if (actionError) throw actionError;

      notifyWhatsAppOperation(
        photoPrompt.request.id,
        photoPrompt.task.type === 'delivery' ? 'delivery_completed' : 'pickup_completed',
        uploadedPaths
      ).catch((notificationError) => {
        console.error('WhatsApp notification failed', notificationError);
      });

      evidencePhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setPhotoPrompt(null);
      setEvidencePhotos([]);
      await loadRequests(true);
    } catch (caughtError) {
      setEvidenceError(caughtError instanceof Error ? caughtError.message : 'Não foi possível enviar a foto.');
    } finally {
      setEvidenceUploading(false);
      setActingTaskId('');
    }
  };

  const toggleCard = (requestId: string) => {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  };

  const toggleColumn = (status: RequestStatus) => {
    setCollapsedColumns((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <LoaderCircle className="spin" size={28} />
        <span>Carregando operação...</span>
      </div>
    );
  }

  return (
    <section className="operations-view">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Acompanhamento em tempo real</p>
          <h1>Fluxo de materiais</h1>
        </div>
        <button className="secondary-button" type="button" onClick={() => void loadRequests(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'spin' : ''} size={17} />
          <span>Atualizar</span>
        </button>
      </div>

      {error && <p className="auth-message error">{error}</p>}

      <div className="kanban-board">
        {columns.map((column) => {
          const ColumnIcon = column.icon;

          return (
            <section className={`kanban-column tone-${column.tone} ${collapsedColumns.has(column.status) ? 'mobile-collapsed' : ''}`} key={column.status}>
              <header>
                <button type="button" onClick={() => toggleColumn(column.status)} aria-expanded={!collapsedColumns.has(column.status)}>
                  <span className="status-icon" aria-hidden="true">
                    <ColumnIcon size={15} />
                  </span>
                  <h2>{column.label}</h2>
                  <ChevronDown className={collapsedColumns.has(column.status) ? '' : 'expanded'} size={17} />
                </button>
                <strong>{groupedRequests[column.status].length}</strong>
              </header>

              <div className="kanban-cards">
                {groupedRequests[column.status].map((request) => {
                  const task = getOpenTask(request);
                  const action = actionForTask(task, profile, access);
                  const ActionIcon = action?.icon;
                  const routeQuery = routeQueryForTask(request, task);
                  const expanded = expandedCards.has(request.id);
                  const canNavigate =
                    Boolean(routeQuery) &&
                    Boolean(task) &&
                    ['assigned', 'in_route'].includes(task?.status || '') &&
                    (task?.assigned_driver_id === profile.id || profile.role === 'admin');

                  return (
                    <article
                      className={`operation-card priority-${request.priority} ${expanded ? 'expanded' : 'collapsed'} ${
                        request.id === highlightedRequestId ? 'highlighted' : ''
                      }`}
                      data-request-id={request.id}
                      key={request.id}
                    >
                      <button
                        className="operation-card-summary"
                        type="button"
                        onClick={() => toggleCard(request.id)}
                        aria-expanded={expanded}
                      >
                        <span>
                          <strong>
                            <small>#{String(request.code).padStart(4, '0')}</small>
                            {request.hospital}
                          </strong>
                        </span>
                        <ChevronDown className={expanded ? 'expanded' : ''} size={18} />
                      </button>

                      {expanded && (
                        <>
                          <div className="operation-card-subtitle">
                            <p>{request.procedure || 'Procedimento não informado'}</p>
                            <span className="item-count">
                              <Box size={14} />
                              {request.request_items.length}
                            </span>
                          </div>

                          <dl className="card-facts">
                            {request.patient && (
                              <div>
                                <dt>
                                  <UserRound size={13} /> Paciente
                                </dt>
                                <dd>{request.patient}</dd>
                              </div>
                            )}
                            {request.surgery_date && (
                              <div>
                                <dt>
                                  <CalendarDays size={13} /> Cirurgia
                                </dt>
                                <dd>
                                  {dateFormatter.format(new Date(`${request.surgery_date}T12:00:00`))}
                                  {request.surgery_time ? ` · ${request.surgery_time.slice(0, 5)}` : ''}
                                </dd>
                              </div>
                            )}
                            {task && (
                              <div>
                                <dt>
                                  <MapPin size={13} /> Rota
                                </dt>
                                <dd className="route-line">
                                  {task.origin_label} <ArrowRight size={12} /> {task.destination_label}
                                </dd>
                              </div>
                            )}
                          </dl>

                          {task?.assigned_driver && (
                            <p className="driver-chip">
                              <Truck size={14} />
                              {task.assigned_driver.full_name || 'Motorista'}
                            </p>
                          )}

                          <div className="operation-actions compact">
                            {canNavigate && (
                              <button
                                className="card-route-button"
                                type="button"
                                onClick={() => setNavigationTarget({ title: request.hospital, query: routeQuery })}
                              >
                                <Navigation size={16} />
                                Navegar
                              </button>
                            )}
                            {action && task && ActionIcon && (
                              <button
                                className="card-action-button"
                                type="button"
                                onClick={() => startTaskAction(request, task, action.action)}
                                disabled={actingTaskId === task.id}
                              >
                                {actingTaskId === task.id ? <LoaderCircle className="spin" size={16} /> : <ActionIcon size={16} />}
                                {action.label}
                              </button>
                            )}
                          </div>

                          <footer className="operation-card-footer">
                            <button type="button" onClick={() => setSelectedRequest(request)}>
                              <Eye size={15} />
                              Detalhes
                            </button>
                          </footer>
                        </>
                      )}
                    </article>
                  );
                })}

                {!groupedRequests[column.status].length && (
                  <div className="empty-column">
                    <CheckCircle2 size={22} />
                    <span>Nenhuma solicitação</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {selectedRequest && (
        <RequestDetails
          profile={profile}
          access={access}
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onChanged={() => void loadRequests(true)}
        />
      )}

      {navigationTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setNavigationTarget(null)}>
          <section className="navigation-modal" role="dialog" aria-modal="true" aria-labelledby="navigation-title">
            <header>
              <div>
                <p className="eyebrow">Navegação</p>
                <h2 id="navigation-title">{navigationTarget.title}</h2>
                <span>{navigationTarget.query}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setNavigationTarget(null)} aria-label="Fechar navegação">
                ×
              </button>
            </header>
            <div className="navigation-modal-actions">
              <button type="button" onClick={() => openNavigation('waze', navigationTarget.query)}>
                <Navigation size={18} />
                Abrir no Waze
              </button>
              <button type="button" onClick={() => openNavigation('maps', navigationTarget.query)}>
                <MapPin size={18} />
                Abrir no Maps
              </button>
            </div>
          </section>
        </div>
      )}

      {photoPrompt && (
        <div className="modal-backdrop" role="presentation">
          <section className="evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Evidência obrigatória</p>
                <h2 id="evidence-title">
                  {photoPrompt.photoType === 'delivery' ? 'Foto da entrega' : 'Foto da retirada'}
                </h2>
                <span>{photoPrompt.request.hospital}</span>
              </div>
              <button className="icon-button" type="button" onClick={closePhotoPrompt} aria-label="Fechar evidência">
                <X size={20} />
              </button>
            </header>

            <EvidencePhotoPicker photos={evidencePhotos} onAddFiles={addEvidencePhotos} onRemove={removeEvidencePhoto} />

            {evidenceError && <p className="auth-message error">{evidenceError}</p>}

            <footer>
              <button className="secondary-button" type="button" onClick={closePhotoPrompt}>
                Cancelar
              </button>
              <button className="card-action-button" type="button" onClick={() => void uploadEvidenceAndRunAction()} disabled={evidenceUploading}>
                {evidenceUploading ? <LoaderCircle className="spin" size={17} /> : <ImageIcon size={17} />}
                Salvar fotos e concluir
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

