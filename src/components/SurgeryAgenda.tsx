import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MapPin,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import type { RoleAccess } from '../permissions';
import { supabase } from '../supabase';
import type { AgendaRequest, Profile } from '../types';
import { InstrumentatorMultiSelect } from './InstrumentatorMultiSelect';

type SurgeryAgendaProps = {
  profile: Profile;
  access: RoleAccess;
};

const weekdayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});

const dateKey = (date: Date) =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

const parseDate = (value: string) => new Date(`${value}T12:00:00`);

const formatTime = (value: string | null) => (value ? value.slice(0, 5) : 'Horário não informado');

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const getMonthRange = (month: Date) => {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { start, end };
};

const getCalendarDays = (month: Date) => {
  const { start, end } = getMonthRange(month);
  const gridStart = addDays(start, -start.getDay());
  const gridEnd = addDays(end, 6 - end.getDay());
  const days: Date[] = [];

  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }

  return days;
};

const bySchedule = (a: AgendaRequest, b: AgendaRequest) =>
  `${a.surgery_date}T${a.surgery_time || '23:59'}`.localeCompare(
    `${b.surgery_date}T${b.surgery_time || '23:59'}`
  );

const requestLabel = (request: AgendaRequest) => `#${String(request.code).padStart(4, '0')}`;

export function SurgeryAgenda({ profile, access }: SurgeryAgendaProps) {
  const today = useMemo(() => new Date(), []);
  const todayKey = dateKey(today);
  const canAssign = access.manage_requests;
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [requests, setRequests] = useState<AgendaRequest[]>([]);
  const [myUpcoming, setMyUpcoming] = useState<AgendaRequest[]>([]);
  const [instrumentators, setInstrumentators] = useState<Pick<Profile, 'id' | 'full_name'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAgenda = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');

    const { start, end } = getMonthRange(month);
    const calendarPromise = supabase.rpc('list_surgery_agenda', {
      period_start: dateKey(start),
      period_end: dateKey(end),
    });
    const instrumentatorsPromise = supabase.rpc('list_active_instrumentators');
    const upcomingEnd = new Date(today);
    upcomingEnd.setFullYear(upcomingEnd.getFullYear() + 1);
    const upcomingPromise =
      profile.role === 'instrumentator'
        ? supabase.rpc('list_surgery_agenda', {
            period_start: todayKey,
            period_end: dateKey(upcomingEnd),
          })
        : Promise.resolve({ data: [], error: null });

    const [calendarResult, instrumentatorsResult, upcomingResult] = await Promise.all([
      calendarPromise,
      instrumentatorsPromise,
      upcomingPromise,
    ]);

    const queryError = calendarResult.error || instrumentatorsResult.error || upcomingResult.error;
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setRequests(((calendarResult.data || []) as AgendaRequest[]).sort(bySchedule));
    setInstrumentators((instrumentatorsResult.data || []) as Pick<Profile, 'id' | 'full_name'>[]);
    setMyUpcoming(
      ((upcomingResult.data || []) as AgendaRequest[])
        .filter((request) => request.assigned_instrumentator_ids.includes(profile.id))
        .sort(bySchedule)
    );
    setLoading(false);
  }, [month, profile.id, profile.role, today, todayKey]);

  useEffect(() => {
    void loadAgenda();

    const channel = supabase
      .channel(`surgery-agenda-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surgery_requests' }, () => void loadAgenda(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surgery_request_instrumentators' }, () => void loadAgenda(true))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadAgenda, profile.id]);

  useEffect(() => {
    const { start, end } = getMonthRange(month);
    if (today >= start && today <= end) setSelectedDate(todayKey);
    else setSelectedDate(dateKey(start));
  }, [month, today, todayKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const requestsByDate = useMemo(() => {
    const grouped = new Map<string, AgendaRequest[]>();
    requests.forEach((request) => {
      const current = grouped.get(request.surgery_date) || [];
      current.push(request);
      grouped.set(request.surgery_date, current);
    });
    return grouped;
  }, [requests]);

  const selectedRequests = requestsByDate.get(selectedDate) || [];
  const calendarDays = useMemo(() => getCalendarDays(month), [month]);
  const todayAssignments = myUpcoming.filter((request) => request.surgery_date === todayKey);
  const now = Date.now();
  const nextAssignment =
    myUpcoming.find(
      (request) =>
        new Date(`${request.surgery_date}T${request.surgery_time?.slice(0, 5) || '23:59'}:00`).getTime() >= now
    ) || null;

  const changeMonth = (amount: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const goToToday = () => {
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
  };

  const assignInstrumentators = async (request: AgendaRequest, instrumentatorIds: string[]) => {
    setAssigningId(request.id);
    setError('');
    setNotice('');

    const { error: assignmentError } = await supabase.rpc('set_request_instrumentators', {
      target_request_id: request.id,
      target_instrumentator_ids: instrumentatorIds,
    });

    if (assignmentError) {
      setError(assignmentError.message);
    } else {
      const selectedNames = instrumentators
        .filter((item) => instrumentatorIds.includes(item.id))
        .map((item) => item.full_name);
      const updateRequest = (item: AgendaRequest) =>
        item.id === request.id
          ? {
              ...item,
              assigned_instrumentator_ids: instrumentatorIds,
              assigned_instrumentator_names: selectedNames,
            }
          : item;
      setRequests((current) => current.map(updateRequest));
      setMyUpcoming((current) => current.map(updateRequest));
      setNotice(
        instrumentatorIds.length
          ? `${instrumentatorIds.length} instrumentador(es) designado(s) com sucesso.`
          : 'Designações removidas.'
      );
    }

    setAssigningId('');
  };

  const renderCompactSurgery = (request: AgendaRequest) => (
    <div className="agenda-compact-surgery" key={request.id}>
      <span>{formatTime(request.surgery_time)}</span>
      <strong>{request.hospital}</strong>
      <small>{request.procedure || request.patient || 'Procedimento não informado'}</small>
    </div>
  );

  return (
    <section className="agenda-view">
      <header className="page-heading agenda-page-heading">
        <div>
          <p className="eyebrow">Planejamento cirúrgico</p>
          <h1>Agenda</h1>
          <span>Visualize as cirurgias e acompanhe as designações dos instrumentadores.</span>
        </div>
        <button className="agenda-today-button" type="button" onClick={goToToday}>
          <CalendarDays size={17} />
          Hoje
        </button>
      </header>

      {profile.role === 'instrumentator' && (
        <section className="agenda-personal-summary" aria-label="Minha agenda">
          <div className="agenda-summary-block">
            <header>
              <span><CalendarDays size={18} /></span>
              <div>
                <p>Minha agenda</p>
                <h2>Cirurgias de hoje</h2>
              </div>
              <strong>{todayAssignments.length}</strong>
            </header>
            <div className="agenda-summary-content">
              {todayAssignments.length ? (
                todayAssignments.map(renderCompactSurgery)
              ) : (
                <p className="agenda-empty-copy">Nenhuma cirurgia designada para você hoje.</p>
              )}
            </div>
          </div>

          <div className="agenda-summary-block next">
            <header>
              <span><Clock3 size={18} /></span>
              <div>
                <p>Próximo compromisso</p>
                <h2>Próximas cirurgias</h2>
              </div>
            </header>
            <div className="agenda-summary-content">
              {nextAssignment ? (
                <>
                  <time>{fullDateFormatter.format(parseDate(nextAssignment.surgery_date))} · {formatTime(nextAssignment.surgery_time)}</time>
                  <strong>{nextAssignment.hospital}</strong>
                  <small>{nextAssignment.procedure || 'Procedimento não informado'}</small>
                </>
              ) : (
                <p className="agenda-empty-copy">Nenhuma próxima cirurgia designada.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {error && <p className="auth-message error">{error}</p>}
      {notice && <p className="auth-message notice">{notice}</p>}

      <section className="agenda-calendar-section">
        <header className="agenda-calendar-toolbar">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={20} /></button>
          <h2>{monthFormatter.format(month)}</h2>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Próximo mês"><ChevronRight size={20} /></button>
        </header>

        {loading ? (
          <div className="agenda-loading"><LoaderCircle className="spin" size={24} /><span>Carregando agenda...</span></div>
        ) : (
          <div className="agenda-calendar">
            {weekdayLabels.map((label) => <div className="agenda-weekday" key={label}>{label}</div>)}
            {calendarDays.map((day) => {
              const key = dateKey(day);
              const dayRequests = requestsByDate.get(key) || [];
              const outsideMonth = day.getMonth() !== month.getMonth();
              return (
                <button
                  className={[
                    'agenda-day',
                    outsideMonth ? 'outside' : '',
                    key === todayKey ? 'today' : '',
                    key === selectedDate ? 'selected' : '',
                  ].filter(Boolean).join(' ')}
                  type="button"
                  key={key}
                  onClick={() => setSelectedDate(key)}
                  disabled={outsideMonth}
                  aria-label={`${fullDateFormatter.format(day)}, ${dayRequests.length} cirurgia(s)`}
                >
                  <span className="agenda-day-number">{day.getDate()}</span>
                  <div className="agenda-day-events">
                    {dayRequests.slice(0, 3).map((request) => (
                      <span className={request.assigned_instrumentator_ids.length ? 'assigned' : 'unassigned'} key={request.id}>
                        <b>{formatTime(request.surgery_time).replace('Horário não informado', '--:--')}</b>
                        {request.hospital}
                      </span>
                    ))}
                    {dayRequests.length > 3 && <small>+{dayRequests.length - 3} cirurgia(s)</small>}
                  </div>
                  {dayRequests.length > 0 && <i>{dayRequests.length}</i>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="agenda-day-schedule">
        <header>
          <div>
            <p>Programação do dia</p>
            <h2>{fullDateFormatter.format(parseDate(selectedDate))}</h2>
          </div>
          <span>{selectedRequests.length} cirurgia(s)</span>
        </header>

        <div className="agenda-surgery-list">
          {selectedRequests.length ? selectedRequests.map((request) => (
            <article className="agenda-surgery-card" key={request.id}>
              <div className="agenda-surgery-time">
                <Clock3 size={17} />
                <strong>{formatTime(request.surgery_time)}</strong>
                <span>{requestLabel(request)}</span>
              </div>
              <div className="agenda-surgery-main">
                <h3>{request.hospital}</h3>
                <p><Stethoscope size={15} /> {request.procedure || 'Procedimento não informado'}</p>
                <div>
                  <span><UserRound size={14} /> {request.patient || 'Paciente não informado'}</span>
                  <span><MapPin size={14} /> {request.surgeon || 'Cirurgião não informado'}</span>
                </div>
              </div>
              <div className="agenda-assignment">
                <div className="multi-select-field">
                  <span>Instrumentadores</span>
                  {canAssign ? (
                    <InstrumentatorMultiSelect
                      options={instrumentators}
                      selectedIds={request.assigned_instrumentator_ids}
                      onChange={(selectedIds) => void assignInstrumentators(request, selectedIds)}
                      disabled={assigningId === request.id}
                      placeholder="Não designado"
                    />
                  ) : (
                    <div className={request.assigned_instrumentator_names.length ? 'agenda-assigned-list' : 'agenda-assigned-list empty'}>
                      {request.assigned_instrumentator_names.length
                        ? request.assigned_instrumentator_names.map((name) => <strong key={name}>{name}</strong>)
                        : <strong>Não designado</strong>}
                    </div>
                  )}
                </div>
                {assigningId === request.id && <LoaderCircle className="spin" size={17} />}
              </div>
            </article>
          )) : (
            <div className="agenda-empty-state">
              <CalendarDays size={28} />
              <strong>Nenhuma cirurgia nesta data</strong>
              <span>Selecione outro dia no calendário para consultar a programação.</span>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
