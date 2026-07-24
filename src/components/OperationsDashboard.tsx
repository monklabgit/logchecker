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
import type { Profile, RequestStatus, SurgeryRequest, TransportTask, TransportType } from '../types';
import { EvidenceDraftModal } from './EvidenceDraftModal';
import { RequestDetails } from './RequestDetails';

type OperationsDashboardProps = {
  profile: Profile;
  access: RoleAccess;
  highlightedRequestId?: string;
  refreshKey?: number;
};

type FlowColumn = {
  key: string;
  label: string;
  tone: string;
  icon: typeof Box;
  statuses: RequestStatus[];
  taskType?: TransportType;
  completed?: boolean;
  matches?: (request: SurgeryRequest) => boolean;
  statusLabel?: (request: SurgeryRequest, task: TransportTask | null) => string;
};

const operationalColumns: FlowColumn[] = [
  { key: 'ready_delivery', statuses: ['ready_delivery'], label: 'Disponível para entrega', tone: 'blue', icon: Box },
  { key: 'delivery_in_route', statuses: ['delivery_in_route'], label: 'Em rota de entrega', tone: 'amber', icon: Truck },
  { key: 'delivered', statuses: ['delivered'], label: 'Entregue', tone: 'green', icon: CheckCircle2 },
  { key: 'ready_pickup', statuses: ['ready_pickup'], label: 'Disponível para retirada', tone: 'purple', icon: PackageCheck },
  { key: 'pickup_in_route', statuses: ['pickup_in_route'], label: 'Em rota de retirada', tone: 'amber', icon: Truck },
  { key: 'returned_stock', statuses: ['returned_stock'], label: 'Retornado ao estoque', tone: 'slate', icon: PackageCheck },
];

const instrumentatorStatusLabels: Record<RequestStatus, string> = {
  ready_delivery: 'Material separado',
  delivery_in_route: 'Em rota para o hospital',
  delivered: 'Material entregue',
  ready_pickup: 'Material liberado',
  pickup_in_route: 'Em rota para o estoque',
  returned_stock: 'Retornado ao estoque',
  cancelled: 'Cancelada',
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const compactDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const requestSchedule = (request: SurgeryRequest) => ({
  date: request.surgery_date
    ? compactDateFormatter.format(new Date(`${request.surgery_date}T12:00:00`))
    : 'Sem data',
  time: request.surgery_time ? request.surgery_time.slice(0, 5) : 'Sem horário',
});

const getOpenTask = (request: SurgeryRequest) =>
  request.transport_tasks
    .filter((task) => !['completed', 'cancelled'].includes(task.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

const getTaskByType = (request: SurgeryRequest, type: TransportType) =>
  request.transport_tasks
    .filter((task) => task.type === type && task.status !== 'cancelled')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

const scheduleTimestamp = (request: SurgeryRequest) => {
  if (!request.surgery_date) return Number.MAX_SAFE_INTEGER;
  const time = request.surgery_time?.slice(0, 5) || '23:59';
  const timestamp = new Date(`${request.surgery_date}T${time}:00`).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
};

const happenedToday = (value: string | null | undefined) => {
  if (!value) return false;
  const eventDate = new Date(value);
  if (Number.isNaN(eventDate.getTime())) return false;
  const today = new Date();
  return (
    eventDate.getFullYear() === today.getFullYear() &&
    eventDate.getMonth() === today.getMonth() &&
    eventDate.getDate() === today.getDate()
  );
};

const driverTaskStatusLabel = (type: TransportType, task: TransportTask | null) => {
  if (!task || task.status === 'available') return type === 'delivery' ? 'Material separado' : 'Material liberado';
  if (task.status === 'assigned') return type === 'delivery' ? 'Entrega designada' : 'Retirada designada';
  if (task.status === 'in_route') return 'Em rota';
  if (task.status === 'completed') return type === 'delivery' ? 'Entrega concluída' : 'Retirada concluída';
  return '';
};

const actionForTask = (task: TransportTask | null, profile: Profile, access: RoleAccess) => {
  if (!task) return null;
  if (task.status === 'available' && access.claim_routes) {
    return { action: 'claim', label: 'Assumir', icon: CircleDot };
  }
  if (task.status === 'assigned' && (task.assigned_driver_id === profile.id || access.manage_requests) && access.claim_routes) {
    return { action: 'start', label: 'Iniciar rota', icon: Play };
  }
  if (task.status === 'in_route' && (task.assigned_driver_id === profile.id || access.manage_requests)) {
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
  const [photoPrompt, setPhotoPrompt] = useState<{ request: SurgeryRequest; task: TransportTask } | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [driverView, setDriverView] = useState<TransportType>('delivery');
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(
    () => new Set([...operationalColumns.map((column) => column.key), 'driver-completed', 'instrumentator-completed'])
  );
  const [navigationTarget, setNavigationTarget] = useState<{ title: string; query: string } | null>(null);

  const loadRequests = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');

    const instrumentatorAssignmentJoin =
      profile.role === 'instrumentator'
        ? ', surgery_request_instrumentators!inner(instrumentator_id)'
        : '';
    let requestQuery = supabase
      .from('surgery_requests')
      .select(
        `*, hospital_record:hospitals(*), request_items(*), transport_tasks(*, assigned_driver:profiles!transport_tasks_assigned_driver_id_fkey(id, full_name)), transport_evidence_photos(*)${instrumentatorAssignmentJoin}`
      )
      .neq('status', 'cancelled');

    if (profile.role === 'instrumentator') {
      requestQuery = requestQuery.eq('surgery_request_instrumentators.instrumentator_id', profile.id);
    }

    const { data, error: queryError } = await requestQuery.order('created_at', { ascending: false });

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
            nextColumns.delete('instrumentator-upcoming');
            nextColumns.delete('instrumentator-completed');
            nextColumns.delete('driver-upcoming');
            nextColumns.delete('driver-in-route');
            nextColumns.delete('driver-completed');
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
  }, [highlightedRequestId, profile.id, profile.role, refreshKey]);

  useEffect(() => {
    void loadRequests();

    const channel = supabase
      .channel('operations-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surgery_requests' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_tasks' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_evidence_photos' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surgery_request_instrumentators' }, () => void loadRequests(true))
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

  const displayColumns = useMemo<FlowColumn[]>(() => {
    if (profile.role === 'instrumentator') {
      return [
        {
          key: 'instrumentator-upcoming',
          label: 'Próximas cirurgias',
          tone: 'blue',
          icon: CalendarDays,
          statuses: ['ready_delivery', 'delivery_in_route', 'delivered'],
          statusLabel: (request) => instrumentatorStatusLabels[request.status],
        },
        {
          key: 'instrumentator-completed',
          label: 'Concluídas hoje',
          tone: 'green',
          icon: CheckCircle2,
          statuses: [],
          completed: true,
          matches: (request) =>
            ['ready_pickup', 'pickup_in_route', 'returned_stock'].includes(request.status) &&
            happenedToday(getTaskByType(request, 'pickup')?.created_at),
          statusLabel: (request) => instrumentatorStatusLabels[request.status],
        },
      ];
    }

    if (profile.role === 'driver') {
      const taskMatches = (request: SurgeryRequest, statuses: TransportTask['status'][]) => {
        const task = getTaskByType(request, driverView);
        if (!task || !statuses.includes(task.status)) return false;
        return task.status === 'available' || task.assigned_driver_id === profile.id;
      };

      return [
        {
          key: 'driver-upcoming',
          label: driverView === 'delivery' ? 'Próximas entregas' : 'Próximas retiradas',
          tone: driverView === 'delivery' ? 'blue' : 'purple',
          icon: driverView === 'delivery' ? Box : PackageCheck,
          statuses: [],
          taskType: driverView,
          matches: (request) => taskMatches(request, ['available', 'assigned']),
          statusLabel: (_request, task) => driverTaskStatusLabel(driverView, task),
        },
        {
          key: 'driver-in-route',
          label: 'Em rota',
          tone: 'amber',
          icon: Truck,
          statuses: [],
          taskType: driverView,
          matches: (request) => taskMatches(request, ['in_route']),
          statusLabel: (_request, task) => driverTaskStatusLabel(driverView, task),
        },
        {
          key: 'driver-completed',
          label: 'Concluídas hoje',
          tone: 'green',
          icon: CheckCircle2,
          statuses: [],
          taskType: driverView,
          completed: true,
          matches: (request) => {
            const task = getTaskByType(request, driverView);
            return taskMatches(request, ['completed']) && happenedToday(task?.completed_at);
          },
          statusLabel: (_request, task) => driverTaskStatusLabel(driverView, task),
        },
      ];
    }

    return operationalColumns;
  }, [driverView, profile.id, profile.role]);

  const groupedRequests = useMemo(
    () =>
      Object.fromEntries(
        displayColumns.map((column) => {
          const matchingRequests = requests.filter((request) =>
            column.matches ? column.matches(request) : column.statuses.includes(request.status)
          );
          if (profile.role === 'driver' || profile.role === 'instrumentator') {
            matchingRequests.sort((a, b) => {
              const aSchedule = scheduleTimestamp(a);
              const bSchedule = scheduleTimestamp(b);
              if (aSchedule === Number.MAX_SAFE_INTEGER) return bSchedule === Number.MAX_SAFE_INTEGER ? 0 : 1;
              if (bSchedule === Number.MAX_SAFE_INTEGER) return -1;
              return column.completed ? bSchedule - aSchedule : aSchedule - bSchedule;
            });
          }
          return [column.key, matchingRequests];
        })
      ) as Record<string, SurgeryRequest[]>,
    [displayColumns, profile.role, requests]
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
      setPhotoPrompt({ request, task });
      return;
    }

    void runTaskAction(task, action);
  };

  const toggleCard = (requestId: string) => {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  };

  const toggleColumn = (status: string) => {
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
          <p className="eyebrow">{profile.role === 'driver' ? 'Operação logística' : profile.role === 'instrumentator' ? 'Cirurgias designadas' : 'Acompanhamento em tempo real'}</p>
          <h1>{profile.role === 'driver' ? 'Minhas rotas' : profile.role === 'instrumentator' ? 'Minhas cirurgias' : 'Fluxo de materiais'}</h1>
        </div>
        <button className="secondary-button" type="button" onClick={() => void loadRequests(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'spin' : ''} size={17} />
          <span>Atualizar</span>
        </button>
      </div>

      {error && <p className="auth-message error">{error}</p>}

      {profile.role === 'driver' && (
        <div className="role-flow-tabs" role="tablist" aria-label="Tipo de rota">
          <button type="button" role="tab" aria-selected={driverView === 'delivery'} className={driverView === 'delivery' ? 'active' : ''} onClick={() => setDriverView('delivery')}>
            <Box size={18} />
            Entregas
          </button>
          <button type="button" role="tab" aria-selected={driverView === 'pickup'} className={driverView === 'pickup' ? 'active' : ''} onClick={() => setDriverView('pickup')}>
            <PackageCheck size={18} />
            Retiradas
          </button>
        </div>
      )}

      <div className={`kanban-board ${profile.role === 'driver' || profile.role === 'instrumentator' ? `role-flow-board role-${profile.role}` : ''}`}>
        {displayColumns.map((column) => {
          const ColumnIcon = column.icon;

          return (
            <section className={`kanban-column tone-${column.tone} ${collapsedColumns.has(column.key) ? 'mobile-collapsed' : ''}`} key={column.key}>
              <header>
                <button type="button" onClick={() => toggleColumn(column.key)} aria-expanded={!collapsedColumns.has(column.key)}>
                  <span className="status-icon" aria-hidden="true">
                    <ColumnIcon size={15} />
                  </span>
                  <h2>{column.label}</h2>
                  <ChevronDown className={collapsedColumns.has(column.key) ? '' : 'expanded'} size={17} />
                </button>
                <strong>{groupedRequests[column.key].length}</strong>
              </header>

              <div className="kanban-cards">
                {groupedRequests[column.key].map((request) => {
                  const schedule = requestSchedule(request);
                  const task = column.taskType ? getTaskByType(request, column.taskType) : getOpenTask(request);
                  const action = actionForTask(task, profile, access);
                  const ActionIcon = action?.icon;
                  const routeQuery = routeQueryForTask(request, task);
                  const savedPhotoCount = task
                    ? request.transport_evidence_photos.filter((photo) => photo.task_id === task.id && new Date(photo.expires_at) > new Date()).length
                    : 0;
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
                        <span className="operation-card-heading">
                          <small className="operation-card-meta">
                            <b>#{String(request.code).padStart(4, '0')}</b>
                            <i>|</i>
                            <time dateTime={request.surgery_date || undefined}>{schedule.date}</time>
                            <i>|</i>
                            <time>{schedule.time}</time>
                          </small>
                          <strong>{request.hospital}</strong>
                        </span>
                        <span className="operation-card-summary-side">
                          {column.statusLabel && <small className="role-status-badge">{column.statusLabel(request, task)}</small>}
                          <ChevronDown className={expanded ? 'expanded' : ''} size={18} />
                        </span>
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
                            {action?.action === 'complete' && task && (
                              <button
                                className="evidence-card-button"
                                type="button"
                                onClick={() => setPhotoPrompt({ request, task })}
                              >
                                <ImageIcon size={16} />
                                Fotos{savedPhotoCount ? ` (${savedPhotoCount})` : ''}
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

                {!groupedRequests[column.key].length && (
                  <div className="empty-column">
                    <CheckCircle2 size={22} />
                    <span>{profile.role === 'instrumentator' ? 'Nenhuma cirurgia' : profile.role === 'driver' ? 'Nenhuma rota' : 'Nenhuma solicitação'}</span>
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
        <EvidenceDraftModal
          request={photoPrompt.request}
          task={photoPrompt.task}
          onClose={() => setPhotoPrompt(null)}
          onChanged={() => void loadRequests(true)}
        />
      )}
    </section>
  );
}

