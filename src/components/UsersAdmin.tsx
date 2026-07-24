import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';
import { ACCESS_KEYS, ACCESS_LABELS, DEFAULT_ROLE_ACCESS, ROLE_LABELS, emptyAccessMap, type AccessKey } from '../permissions';
import { supabase } from '../supabase';
import type { AdminProfile, RoleAccessScope, UserRole } from '../types';

const ROLES = Object.keys(ROLE_LABELS) as UserRole[];

type AdminTab = 'users' | 'access';
type AccessMap = ReturnType<typeof emptyAccessMap>;

const toAccessMap = (rows: RoleAccessScope[]): AccessMap => {
  const map = emptyAccessMap();

  for (const row of rows) {
    if (row.role in map && ACCESS_KEYS.includes(row.access_key as AccessKey)) {
      map[row.role][row.access_key as AccessKey] = row.enabled;
    }
  }

  return map;
};

export function UsersAdmin() {
  const [tab, setTab] = useState<AdminTab>('users');
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [accessMap, setAccessMap] = useState<AccessMap>(() => emptyAccessMap());
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState('');
  const [savingAccess, setSavingAccess] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    if (!query) return profiles;

    return profiles.filter((profile) =>
      [profile.full_name, profile.email, profile.phone, ROLE_LABELS[profile.role]]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(query)
    );
  }, [profiles, search]);

  const loadAdminData = async () => {
    setError('');

    const [{ data: profileRows, error: profilesError }, { data: accessRows, error: accessError }] = await Promise.all([
      supabase.rpc('admin_list_profiles'),
      supabase.from('role_access_scopes').select('role, access_key, enabled, updated_at'),
    ]);

    if (profilesError) {
      setError(profilesError.message);
    } else {
      setProfiles((profileRows || []) as AdminProfile[]);
    }

    if (accessError) {
      setAccessMap(emptyAccessMap());
      if (!profilesError) setError(accessError.message);
    } else {
      setAccessMap(toAccessMap((accessRows || []) as RoleAccessScope[]));
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  const updateProfile = async (profile: AdminProfile, changes: Partial<Pick<AdminProfile, 'role' | 'active'>>) => {
    setSavingUserId(profile.id);
    setError('');
    setNotice('');

    const { data, error: updateError } = await supabase
      .from('profiles')
      .update(changes)
      .eq('id', profile.id)
      .select('id, full_name, phone, role, active, created_at, updated_at')
      .single();

    if (updateError) {
      setError(updateError.message);
    } else {
      setProfiles((current) =>
        current.map((item) => (item.id === profile.id ? { ...item, ...data, email: profile.email } as AdminProfile : item))
      );
      setNotice('Usuário atualizado.');
    }

    setSavingUserId('');
  };

  const toggleAccess = async (role: UserRole, accessKey: AccessKey) => {
    const nextEnabled = !accessMap[role][accessKey];
    setSavingAccess(`${role}:${accessKey}`);
    setError('');
    setNotice('');

    const { error: upsertError } = await supabase
      .from('role_access_scopes')
      .upsert(
        {
          role,
          access_key: accessKey,
          enabled: nextEnabled,
        },
        { onConflict: 'role,access_key' }
      );

    if (upsertError) {
      setError(upsertError.message);
    } else {
      setAccessMap((current) => ({
        ...current,
        [role]: {
          ...current[role],
          [accessKey]: nextEnabled,
        },
      }));
      setNotice('Escopo atualizado.');
    }

    setSavingAccess('');
  };

  const restoreDefaults = async (role: UserRole) => {
    setSavingAccess(`${role}:defaults`);
    setError('');
    setNotice('');

    const rows = ACCESS_KEYS.map((accessKey) => ({
      role,
      access_key: accessKey,
      enabled: DEFAULT_ROLE_ACCESS[role][accessKey],
    }));

    const { error: upsertError } = await supabase.from('role_access_scopes').upsert(rows, { onConflict: 'role,access_key' });

    if (upsertError) {
      setError(upsertError.message);
    } else {
      setAccessMap((current) => ({
        ...current,
        [role]: { ...DEFAULT_ROLE_ACCESS[role] },
      }));
      setNotice(`Escopo de ${ROLE_LABELS[role]} restaurado.`);
    }

    setSavingAccess('');
  };

  return (
    <section className="admin-view users-admin-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Usuários e Acessos</h1>
          <span>Defina funções, libere cadastros e ajuste o que cada tipo de usuário pode acessar.</span>
        </div>
      </header>

      <div className="admin-tabs" role="tablist" aria-label="Administração de usuários">
        <button className={tab === 'users' ? 'active' : ''} type="button" onClick={() => setTab('users')}>
          <Users size={17} />
          Usuários
        </button>
        <button className={tab === 'access' ? 'active' : ''} type="button" onClick={() => setTab('access')}>
          <SlidersHorizontal size={17} />
          Acessos
        </button>
      </div>

      {notice && <p className="auth-message notice">{notice}</p>}
      {error && <p className="auth-message error">{error}</p>}

      {loading ? (
        <div className="dashboard-loading">
          <LoaderCircle className="spin" size={24} />
          <span>Carregando administração...</span>
        </div>
      ) : tab === 'users' ? (
        <section className="request-section">
          <div className="request-section-heading">
            <div>
              <p>Usuários Cadastrados</p>
              <h2>Funções</h2>
            </div>
            <input className="admin-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuário..." />
          </div>

          <div className="user-admin-list">
            {filteredProfiles.map((profile) => (
              <article className={`user-admin-card ${profile.active ? '' : 'inactive'}`} key={profile.id}>
                <div className="user-admin-identity">
                  <span>
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <strong>{profile.full_name || 'Usuário sem nome'}</strong>
                    <small>{profile.email}</small>
                    {profile.phone && <small>WhatsApp: +{profile.phone}</small>}
                  </div>
                </div>

                <label>
                  <span>Função</span>
                  <select
                    value={profile.role}
                    disabled={savingUserId === profile.id}
                    onChange={(event) => void updateProfile(profile, { role: event.target.value as UserRole })}
                  >
                    {ROLES.map((role) => (
                      <option value={role} key={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={profile.active}
                    disabled={savingUserId === profile.id}
                    onChange={(event) => void updateProfile(profile, { active: event.target.checked })}
                  />
                  <span>{profile.active ? 'Ativo' : 'Bloqueado'}</span>
                </label>
              </article>
            ))}

            {!filteredProfiles.length && (
              <div className="empty-column">
                <Users size={22} />
                <span>Nenhum usuário encontrado</span>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="access-scope-grid">
          {ROLES.filter((role) => role !== 'pending').map((role) => (
            <article className="access-role-card" key={role}>
              <header>
                <div>
                  <p>{role}</p>
                  <h2>{ROLE_LABELS[role]}</h2>
                </div>
                <button type="button" onClick={() => void restoreDefaults(role)} disabled={savingAccess === `${role}:defaults`}>
                  {savingAccess === `${role}:defaults` ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
                  Padrão
                </button>
              </header>

              <div className="access-list">
                {ACCESS_KEYS.map((accessKey) => (
                  <label className="access-toggle" key={accessKey}>
                    <input
                      type="checkbox"
                      checked={accessMap[role][accessKey]}
                      disabled={savingAccess === `${role}:${accessKey}` || role === 'admin'}
                      onChange={() => void toggleAccess(role, accessKey)}
                    />
                    <span>
                      <strong>{ACCESS_LABELS[accessKey].title}</strong>
                      <small>{ACCESS_LABELS[accessKey].description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
