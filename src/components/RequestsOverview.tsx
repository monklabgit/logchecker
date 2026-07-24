import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardPlus, Edit3, Eye, ListRestart, LoaderCircle, Search, SlidersHorizontal, Trash2, UserRound, UserRoundCheck, X } from 'lucide-react';
import type { RoleAccess } from '../permissions';
import { supabase } from '../supabase';
import type { Hospital, Profile, RequestStatus, SurgeryRequest, TransportTask } from '../types';
import { NewRequestForm } from './NewRequestForm';
import { RequestDetails } from './RequestDetails';

type RequestsOverviewProps = {
  profile: Profile;
  access: RoleAccess;
  onRequestCreated?: (requestId: string) => void;
};

type PeriodFilter = 'all' | 'today' | 'week' | 'month';

type EditForm = {
  hospitalId: string;
  hospital: string;
  surgeon: string;
  patient: string;
  surgeryDate: string;
  surgeryTime: string;
  procedure: string;
  insurance: string;
  observation: string;
  priority: string;
};

type EditItem = {
  id: string;
  section: 'CME' | 'OPME' | 'OTHER';
  quantity: string;
  description: string;
  note: string;
};

const statusLabels: Record<RequestStatus, string> = {
  ready_delivery: 'Disponível para entrega',
  delivery_in_route: 'Em rota de entrega',
  delivered: 'Entregue',
  ready_pickup: 'Disponível para retirada',
  pickup_in_route: 'Em rota de retirada',
  returned_stock: 'Retornado ao estoque',
  cancelled: 'Cancelada',
};

const priorityLabels: Record<number, string> = {
  1: 'Alta',
  2: 'Normal',
  3: 'Baixa',
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const inPeriod = (request: SurgeryRequest, period: PeriodFilter) => {
  if (period === 'all') return true;
  if (!request.surgery_date) return false;

  const surgeryDate = startOfDay(new Date(`${request.surgery_date}T12:00:00`));
  const today = startOfDay(new Date());

  if (period === 'today') return surgeryDate.getTime() === today.getTime();

  if (period === 'week') {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return surgeryDate >= weekStart && surgeryDate <= weekEnd;
  }

  if (period === 'month') {
    return surgeryDate.getFullYear() === today.getFullYear() && surgeryDate.getMonth() === today.getMonth();
  }

  return false;
};

const makeEmptyItem = (section: 'CME' | 'OPME' | 'OTHER' = 'CME'): EditItem => ({
  id: crypto.randomUUID(),
  section,
  quantity: '',
  description: '',
  note: '',
});

const formFromRequest = (request: SurgeryRequest): EditForm => ({
  hospitalId: request.hospital_id || '',
  hospital: request.hospital,
  surgeon: request.surgeon,
  patient: request.patient,
  surgeryDate: request.surgery_date || '',
  surgeryTime: request.surgery_time ? request.surgery_time.slice(0, 5) : '',
  procedure: request.procedure,
  insurance: request.insurance,
  observation: request.observation,
  priority: String(request.priority || 2),
});

const getOpenAssignableTask = (request: SurgeryRequest) =>
  request.transport_tasks
    .filter((task) => ['available', 'assigned'].includes(task.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

export function RequestsOverview({ profile, access, onRequestCreated }: RequestsOverviewProps) {
  const [requests, setRequests] = useState<SurgeryRequest[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<SurgeryRequest | null>(null);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [editingRequest, setEditingRequest] = useState<SurgeryRequest | null>(null);
  const [assigningRequest, setAssigningRequest] = useState<SurgeryRequest | null>(null);
  const [assigningTask, setAssigningTask] = useState<TransportTask | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [deleteRequestTarget, setDeleteRequestTarget] = useState<SurgeryRequest | null>(null);
  const [statusRequestTarget, setStatusRequestTarget] = useState<SurgeryRequest | null>(null);
  const [manualStatus, setManualStatus] = useState<RequestStatus>('ready_delivery');
  const [manualStatusNote, setManualStatusNote] = useState('');
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [cancellingId, setCancellingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('week');
  const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all');

  const handleRequestCreated = async (requestId: string) => {
    setCreatingRequest(false);
    setNotice('Solicitação salva com sucesso e disponível para entrega.');
    onRequestCreated?.(requestId);
    const nextRequests = await loadRequests(true);
    setSelectedRequest(nextRequests.find((request) => request.id === requestId) || null);
  };

  const loadRequests = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');

    const { data, error: queryError } = await supabase
      .from('surgery_requests')
      .select(
        '*, hospital_record:hospitals(*), request_items(*), transport_tasks(*, assigned_driver:profiles!transport_tasks_assigned_driver_id_fkey(id, full_name)), transport_evidence_photos(*)'
      )
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return [] as SurgeryRequest[];
    } else {
      const nextRequests = (data || []) as unknown as SurgeryRequest[];
      setRequests(nextRequests);
      setSelectedRequest((current) => (current ? nextRequests.find((request) => request.id === current.id) || null : null));
      setLoading(false);
      return nextRequests;
    }
  };

  const loadHospitals = async () => {
    const { data } = await supabase.from('hospitals').select('*').eq('active', true).order('name', { ascending: true });
    setHospitals((data || []) as Hospital[]);
  };

  const loadDrivers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, active')
      .eq('role', 'driver')
      .eq('active', true)
      .order('full_name', { ascending: true });
    setDrivers((data || []) as Profile[]);
  };

  useEffect(() => {
    void loadRequests();
    void loadHospitals();
    void loadDrivers();

    const channel = supabase
      .channel('requests-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surgery_requests' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'request_items' }, () => void loadRequests(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_tasks' }, () => void loadRequests(true))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');

    return requests.filter((request) => {
      const matchesSearch =
        !query ||
        [
          String(request.code),
          request.hospital,
          request.procedure,
          request.insurance,
          request.patient,
          request.surgeon,
          request.request_items.map((item) => item.description).join(' '),
        ]
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(query);
      const matchesStatus = statusFilter === 'all' || request.status === statusFilter;
      return matchesSearch && matchesStatus && inPeriod(request, period);
    });
  }, [period, requests, search, statusFilter]);

  const startEdit = (request: SurgeryRequest) => {
    setNotice('');
    setError('');
    setEditingRequest(request);
    setEditForm(formFromRequest(request));
    setEditItems(
      request.request_items.length
        ? request.request_items.map((item) => ({
            id: item.id,
            section: item.section,
            quantity: item.quantity,
            description: item.description,
            note: item.note,
          }))
        : [makeEmptyItem()]
    );
  };

  const updateEditForm = (key: keyof EditForm, value: string) => {
    setEditForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const chooseEditHospital = (hospitalId: string) => {
    const hospital = hospitals.find((item) => item.id === hospitalId);
    setEditForm((current) =>
      current
        ? {
            ...current,
            hospitalId,
            hospital: hospital ? hospital.name : current.hospital,
          }
        : current
    );
  };

  const updateEditItem = (id: string, key: keyof Omit<EditItem, 'id'>, value: string) => {
    setEditItems((current) => current.map((item) => (item.id === id ? { ...item, [key]: value as never } : item)));
  };

  const removeEditItem = (id: string) => {
    setEditItems((current) => {
      const next = current.filter((item) => item.id !== id);
      return next.length ? next : [makeEmptyItem()];
    });
  };

  const openAssignDriver = (request: SurgeryRequest) => {
    const task = getOpenAssignableTask(request);
    if (!task) return;
    setNotice('');
    setError('');
    setAssigningRequest(request);
    setAssigningTask(task);
    setSelectedDriverId(task.assigned_driver_id || '');
  };

  const assignDriver = async () => {
    if (!assigningRequest || !assigningTask || !selectedDriverId) {
      setError('Selecione um motorista.');
      return;
    }

    setAssigning(true);
    setError('');
    setNotice('');

    try {
      const { error: assignError } = await supabase.rpc('assign_transport_task', {
        target_task_id: assigningTask.id,
        target_driver_id: selectedDriverId,
        action_note: 'Designado pela operação',
      });
      if (assignError) throw assignError;

      setNotice('Motorista designado.');
      setAssigningRequest(null);
      setAssigningTask(null);
      setSelectedDriverId('');
      await loadRequests(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível designar o motorista.');
    } finally {
      setAssigning(false);
    }
  };

  const openManualStatus = (request: SurgeryRequest) => {
    setNotice('');
    setError('');
    setStatusRequestTarget(request);
    setManualStatus(request.status === 'cancelled' ? 'ready_delivery' : request.status);
    setManualStatusNote('');
  };

  const updateRequestStatusManually = async () => {
    if (!statusRequestTarget || manualStatus === 'cancelled') return;
    if (manualStatus === statusRequestTarget.status) {
      setError('Selecione um status diferente do atual.');
      return;
    }

    setUpdatingStatus(true);
    setError('');
    setNotice('');

    try {
      const { error: updateError } = await supabase.rpc('set_request_status_manually', {
        target_request_id: statusRequestTarget.id,
        target_status: manualStatus,
        action_note: manualStatusNote.trim(),
      });
      if (updateError) throw updateError;

      setNotice(`Status alterado para “${statusLabels[manualStatus]}”. Tarefas e estoque foram sincronizados.`);
      setStatusRequestTarget(null);
      setManualStatusNote('');
      await loadRequests(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível alterar o status da solicitação.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const saveEdit = async () => {
    if (!editingRequest || !editForm) return;
    if (!editForm.hospital.trim()) {
      setError('Informe o hospital da solicitação.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const scheduledFor = editForm.surgeryDate
        ? `${editForm.surgeryDate}T${editForm.surgeryTime || '00:00'}:00`
        : null;

      const { error: requestError } = await supabase
        .from('surgery_requests')
        .update({
          hospital_id: editForm.hospitalId || null,
          hospital: editForm.hospital.trim(),
          surgeon: editForm.surgeon.trim(),
          patient: editForm.patient.trim(),
          surgery_date: editForm.surgeryDate || null,
          surgery_time: editForm.surgeryTime || null,
          procedure: editForm.procedure.trim(),
          insurance: editForm.insurance.trim(),
          observation: editForm.observation.trim(),
          priority: Number(editForm.priority),
        })
        .eq('id', editingRequest.id);

      if (requestError) throw requestError;

      const existingIds = new Set(editingRequest.request_items.map((item) => item.id));
      const keptIds = new Set(editItems.filter((item) => existingIds.has(item.id) && item.description.trim()).map((item) => item.id));
      const idsToDelete = [...existingIds].filter((id) => !keptIds.has(id));

      if (idsToDelete.length) {
        const { error: deleteError } = await supabase.from('request_items').delete().in('id', idsToDelete);
        if (deleteError) throw deleteError;
      }

      for (const item of editItems.filter((currentItem) => currentItem.description.trim())) {
        const payload = {
          request_id: editingRequest.id,
          section: item.section,
          quantity: item.quantity.trim(),
          description: item.description.trim(),
          note: item.note.trim(),
        };

        if (existingIds.has(item.id)) {
          const { error: updateError } = await supabase.from('request_items').update(payload).eq('id', item.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase.from('request_items').insert(payload);
          if (insertError) throw insertError;
        }
      }

      const { error: taskError } = await supabase
        .from('transport_tasks')
        .update({
          destination_label: editForm.hospital.trim(),
          scheduled_for: scheduledFor,
        })
        .eq('request_id', editingRequest.id)
        .eq('type', 'delivery')
        .in('status', ['available', 'assigned', 'in_route']);

      if (taskError) throw taskError;

      setNotice('Solicitação atualizada.');
      setEditingRequest(null);
      setEditForm(null);
      setEditItems([]);
      await loadRequests(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível editar a solicitação.');
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (request: SurgeryRequest) => {
    setCancellingId(request.id);
    setError('');
    setNotice('');

    try {
      const { error: requestError } = await supabase.from('surgery_requests').update({ status: 'cancelled' }).eq('id', request.id);
      if (requestError) throw requestError;

      const { error: taskError } = await supabase
        .from('transport_tasks')
        .update({ status: 'cancelled' })
        .eq('request_id', request.id)
        .not('status', 'in', '(completed,cancelled)');

      if (taskError) throw taskError;

      setNotice('Solicitação cancelada.');
      setDeleteRequestTarget(null);
      await loadRequests(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancellingId('');
    }
  };

  const deleteRequestPermanently = async (request: SurgeryRequest) => {
    setDeletingId(request.id);
    setError('');
    setNotice('');

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Sessão ausente. Entre novamente para excluir a solicitação.');

      const response = await fetch('/api/delete-surgery-request', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId: request.id }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; deletedEvidenceFiles?: number } | null;
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível excluir a solicitação.');

      const evidenceMessage = payload?.deletedEvidenceFiles
        ? ` ${payload.deletedEvidenceFiles} arquivo(s) de evidência também foram removidos.`
        : '';
      setNotice(`Solicitação excluída definitivamente e materiais retornados ao estoque.${evidenceMessage}`);
      setDeleteRequestTarget(null);
      setSelectedRequest((current) => (current?.id === request.id ? null : current));
      await loadRequests(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível excluir a solicitação.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <section className="admin-view operations-overview">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Operação</p>
          <h1>Solicitações</h1>
          <span>Visão geral das cirurgias, etapas do fluxo e ações operacionais.</span>
        </div>
      </header>

      {notice && <p className="auth-message notice">{notice}</p>}
      {error && <p className="auth-message error">{error}</p>}

      <section className="overview-stats-grid">
        {(Object.keys(statusLabels) as RequestStatus[]).map((status) => (
          <article className={`overview-stat status-${status}`} key={status}>
            <span>{statusLabels[status]}</span>
            <strong>{requests.filter((request) => request.status === status).length}</strong>
          </article>
        ))}
      </section>

      <section className="request-section">
        <div className="request-section-heading overview-heading">
          <div>
            <p>Controle operacional</p>
            <h2>Lista de solicitações</h2>
          </div>
          <div className="overview-filters">
            {access.create_requests && (
              <button className="overview-new-request-button" type="button" onClick={() => setCreatingRequest(true)}>
                <ClipboardPlus size={16} />
                Nova solicitação
              </button>
            )}
            <label className="inventory-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar hospital, paciente ou material..." />
            </label>
            <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodFilter)} aria-label="Filtrar período">
              <option value="today">Hoje</option>
              <option value="week">Esta semana</option>
              <option value="month">Este mês</option>
              <option value="all">Todos</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | RequestStatus)} aria-label="Filtrar status">
              <option value="all">Todos status</option>
              {(Object.keys(statusLabels) as RequestStatus[]).map((status) => (
                <option value={status} key={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="dashboard-loading">
            <LoaderCircle className="spin" size={24} />
            <span>Carregando solicitações...</span>
          </div>
        ) : (
          <div className="overview-list">
            {filteredRequests.map((request) => {
              const assignableTask = getOpenAssignableTask(request);
              const routeTask =
                request.transport_tasks
                  .filter((task) => task.status === 'in_route' && task.type === (request.status === 'pickup_in_route' ? 'pickup' : 'delivery'))
                  .sort((a, b) => b.started_at?.localeCompare(a.started_at || '') || b.created_at.localeCompare(a.created_at))[0] || null;

              return (
                <article className={`overview-request-card status-${request.status}`} key={request.id}>
                  <div className="overview-request-main">
                    <span className="request-code">#{String(request.code).padStart(4, '0')}</span>
                    <h3>{request.hospital}</h3>
                    <p>{request.procedure || 'Procedimento não informado'}</p>
                    <div className="overview-request-meta">
                      <span>
                        <CalendarDays size={14} />
                        {request.surgery_date ? dateFormatter.format(new Date(`${request.surgery_date}T12:00:00`)) : 'Sem data'}
                        {request.surgery_time ? ` · ${request.surgery_time.slice(0, 5)}` : ''}
                      </span>
                      <span>{request.patient || 'Paciente não informado'}</span>
                      <span>{request.request_items.length} material(is)</span>
                      {routeTask?.assigned_driver && (
                        <span className="overview-driver-meta">
                          <UserRound size={14} />
                          Motorista: {routeTask.assigned_driver.full_name || 'Sem nome'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="overview-request-state">
                    <span className="overview-status-pill">{statusLabels[request.status]}</span>
                    <small>Prioridade {priorityLabels[request.priority] || 'Normal'}</small>
                  </div>
                  <div className="overview-actions" aria-label="Ações da solicitação">
                    {access.manage_requests && (
                    <button
                      type="button"
                      onClick={() => openManualStatus(request)}
                      disabled={request.status === 'cancelled'}
                      title="Alterar status manualmente"
                      aria-label="Alterar status manualmente"
                    >
                      <ListRestart size={16} />
                    </button>
                    )}
                    {access.manage_requests && (
                    <button
                      type="button"
                      onClick={() => openAssignDriver(request)}
                      disabled={!assignableTask || !drivers.length || request.status === 'cancelled'}
                      title="Designar motorista"
                      aria-label="Designar motorista"
                    >
                      <UserRoundCheck size={16} />
                    </button>
                    )}
                    <button type="button" onClick={() => setSelectedRequest(request)} title="Ver detalhes" aria-label="Ver detalhes">
                      <Eye size={16} />
                    </button>
                    {access.manage_requests && (
                      <>
                    <button type="button" onClick={() => startEdit(request)} title="Editar solicitação" aria-label="Editar solicitação">
                      <Edit3 size={16} />
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => setDeleteRequestTarget(request)}
                      disabled={cancellingId === request.id || deletingId === request.id}
                      title="Cancelar ou excluir"
                      aria-label="Cancelar ou excluir"
                    >
                      {cancellingId === request.id || deletingId === request.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                    </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}

            {!filteredRequests.length && (
              <div className="empty-column">
                <SlidersHorizontal size={22} />
                <span>Nenhuma solicitação encontrada</span>
              </div>
            )}
          </div>
        )}
      </section>

      {selectedRequest && (
        <RequestDetails
          profile={profile}
          access={access}
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onChanged={() => void loadRequests(true)}
        />
      )}

      {creatingRequest && (
        <NewRequestForm
          modal
          onClose={() => setCreatingRequest(false)}
          onSaved={(requestId) => void handleRequestCreated(requestId)}
        />
      )}

      {assigningRequest && assigningTask && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !assigning && setAssigningRequest(null)}>
          <section className="action-modal" role="dialog" aria-modal="true" aria-labelledby="assign-driver-title">
            <header>
              <div>
                <p className="eyebrow">Designar motorista</p>
                <h2 id="assign-driver-title">#{String(assigningRequest.code).padStart(4, '0')} - {assigningRequest.hospital}</h2>
                <span>{assigningTask.type === 'delivery' ? 'Entrega' : 'Retirada'}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setAssigningRequest(null)} disabled={assigning} aria-label="Fechar designação">
                <X size={20} />
              </button>
            </header>

            <label>
              <span>Motorista</span>
              <select value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)} autoFocus>
                <option value="">Selecionar motorista</option>
                {drivers.map((driver) => (
                  <option value={driver.id} key={driver.id}>
                    {driver.full_name || 'Motorista sem nome'}
                  </option>
                ))}
              </select>
            </label>

            {!drivers.length && <p className="auth-message warning">Nenhum motorista ativo encontrado.</p>}

            <footer>
              <button className="card-detail-button" type="button" onClick={() => setAssigningRequest(null)} disabled={assigning}>
                Cancelar
              </button>
              <button className="card-action-button" type="button" onClick={() => void assignDriver()} disabled={assigning || !selectedDriverId}>
                {assigning ? <LoaderCircle className="spin" size={16} /> : <UserRoundCheck size={16} />}
                Designar
              </button>
            </footer>
          </section>
        </div>
      )}

      {statusRequestTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !updatingStatus && setStatusRequestTarget(null)}>
          <section className="action-modal" role="dialog" aria-modal="true" aria-labelledby="manual-status-title">
            <header>
              <div>
                <p className="eyebrow">Ajuste temporário</p>
                <h2 id="manual-status-title">#{String(statusRequestTarget.code).padStart(4, '0')} - {statusRequestTarget.hospital}</h2>
                <span>Status atual: {statusLabels[statusRequestTarget.status]}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setStatusRequestTarget(null)} disabled={updatingStatus} aria-label="Fechar alteração de status">
                <X size={20} />
              </button>
            </header>

            <div className="manual-status-copy">
              <strong>Esta ação ignora as etapas e evidências do fluxo normal.</strong>
              <p>As tarefas abertas serão ajustadas e os materiais acompanharão o novo status. Nenhuma mensagem será enviada ao WhatsApp.</p>
            </div>

            <label>
              <span>Novo status</span>
              <select value={manualStatus} onChange={(event) => setManualStatus(event.target.value as RequestStatus)} autoFocus>
                {(Object.keys(statusLabels) as RequestStatus[])
                  .filter((status) => status !== 'cancelled')
                  .map((status) => (
                    <option value={status} key={status}>{statusLabels[status]}</option>
                  ))}
              </select>
            </label>

            <label>
              <span>Motivo ou observação (opcional)</span>
              <textarea
                value={manualStatusNote}
                onChange={(event) => setManualStatusNote(event.target.value)}
                rows={3}
                placeholder="Ex.: Etapa concluída antes da implantação do fluxo completo"
              />
            </label>

            <footer>
              <button className="card-detail-button" type="button" onClick={() => setStatusRequestTarget(null)} disabled={updatingStatus}>
                Cancelar
              </button>
              <button
                className="card-action-button"
                type="button"
                onClick={() => void updateRequestStatusManually()}
                disabled={updatingStatus || manualStatus === statusRequestTarget.status}
              >
                {updatingStatus ? <LoaderCircle className="spin" size={16} /> : <ListRestart size={16} />}
                {updatingStatus ? 'Atualizando...' : 'Atualizar status'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {deleteRequestTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !deletingId && !cancellingId && setDeleteRequestTarget(null)}>
          <section className="action-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-request-title">
            <header>
              <div>
                <p className="eyebrow">Ação da solicitação</p>
                <h2 id="delete-request-title">#{String(deleteRequestTarget.code).padStart(4, '0')} - {deleteRequestTarget.hospital}</h2>
                <span>Escolha se deseja apenas cancelar ou remover definitivamente.</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setDeleteRequestTarget(null)} disabled={Boolean(deletingId || cancellingId)} aria-label="Fechar ação">
                <X size={20} />
              </button>
            </header>

            <div className="danger-modal-copy">
              <strong>Excluir definitivamente remove a solicitação e registros relacionados do banco.</strong>
              <p>Antes de apagar, os materiais vinculados voltam para "No estoque". Esta ação não aparece mais na lista.</p>
            </div>

            <footer>
              <button className="card-detail-button" type="button" onClick={() => void cancelRequest(deleteRequestTarget)} disabled={Boolean(cancellingId || deletingId) || deleteRequestTarget.status === 'cancelled'}>
                {cancellingId === deleteRequestTarget.id ? <LoaderCircle className="spin" size={16} /> : <X size={16} />}
                Cancelar solicitação
              </button>
              <button className="danger-action-button" type="button" onClick={() => void deleteRequestPermanently(deleteRequestTarget)} disabled={Boolean(cancellingId || deletingId)}>
                {deletingId === deleteRequestTarget.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                Excluir definitivamente
              </button>
            </footer>
          </section>
        </div>
      )}

      {editingRequest && editForm && (
        <div className="modal-backdrop" role="presentation">
          <section className="edit-request-modal" role="dialog" aria-modal="true" aria-labelledby="edit-request-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">Editar solicitação</p>
                <h2 id="edit-request-title">#{String(editingRequest.code).padStart(4, '0')}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingRequest(null)} aria-label="Fechar edição">
                <X size={20} />
              </button>
            </header>

            <div className="edit-request-body">
              <section className="operational-form-grid">
                <label>
                  <span>Hospital</span>
                  <select value={editForm.hospitalId} onChange={(event) => chooseEditHospital(event.target.value)}>
                    <option value="">Manter texto atual</option>
                    {hospitals.map((hospital) => (
                      <option value={hospital.id} key={hospital.id}>
                        {hospital.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Nome do hospital</span>
                  <input value={editForm.hospital} onChange={(event) => updateEditForm('hospital', event.target.value)} />
                </label>
                <label>
                  <span>Procedimento</span>
                  <input value={editForm.procedure} onChange={(event) => updateEditForm('procedure', event.target.value)} />
                </label>
                <label>
                  <span>Cirurgião</span>
                  <input value={editForm.surgeon} onChange={(event) => updateEditForm('surgeon', event.target.value)} />
                </label>
                <label>
                  <span>Paciente</span>
                  <input value={editForm.patient} onChange={(event) => updateEditForm('patient', event.target.value)} />
                </label>
                <label>
                  <span>Data da cirurgia</span>
                  <input type="date" value={editForm.surgeryDate} onChange={(event) => updateEditForm('surgeryDate', event.target.value)} />
                </label>
                <label>
                  <span>Horário</span>
                  <input type="time" value={editForm.surgeryTime} onChange={(event) => updateEditForm('surgeryTime', event.target.value)} />
                </label>
                <label>
                  <span>Convênio</span>
                  <input value={editForm.insurance} onChange={(event) => updateEditForm('insurance', event.target.value)} />
                </label>
                <label>
                  <span>Prioridade</span>
                  <select value={editForm.priority} onChange={(event) => updateEditForm('priority', event.target.value)}>
                    <option value="1">Alta</option>
                    <option value="2">Normal</option>
                    <option value="3">Baixa</option>
                  </select>
                </label>
                <label className="wide">
                  <span>Observações</span>
                  <textarea value={editForm.observation} onChange={(event) => updateEditForm('observation', event.target.value)} rows={3} />
                </label>
              </section>

              <section className="edit-items-section">
                <div className="request-section-heading">
                  <div>
                    <p>Materiais</p>
                    <h2>Itens da solicitação</h2>
                  </div>
                  <button type="button" onClick={() => setEditItems((current) => [...current, makeEmptyItem()])}>
                    Adicionar item
                  </button>
                </div>
                <div className="edit-items-list">
                  {editItems.map((item) => (
                    <div className="edit-item-row" key={item.id}>
                      <select value={item.section} onChange={(event) => updateEditItem(item.id, 'section', event.target.value)}>
                        <option value="CME">CME</option>
                        <option value="OPME">OPME</option>
                        <option value="OTHER">Outros</option>
                      </select>
                      <input value={item.quantity} onChange={(event) => updateEditItem(item.id, 'quantity', event.target.value)} placeholder="Qtd." />
                      <input value={item.description} onChange={(event) => updateEditItem(item.id, 'description', event.target.value)} placeholder="Descrição" />
                      <input value={item.note} onChange={(event) => updateEditItem(item.id, 'note', event.target.value)} placeholder="Kit / observação" />
                      <button type="button" onClick={() => removeEditItem(item.id)} aria-label="Remover item">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <footer>
              <button className="card-detail-button" type="button" onClick={() => setEditingRequest(null)} disabled={saving}>
                Cancelar
              </button>
              <button className="card-action-button" type="button" onClick={() => void saveEdit()} disabled={saving}>
                {saving ? <LoaderCircle className="spin" size={16} /> : <Edit3 size={16} />}
                Salvar alterações
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
