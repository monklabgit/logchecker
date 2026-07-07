import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Archive, Building2, ClipboardPlus, ListChecks, LoaderCircle, LogOut, Menu, RefreshCw, Route, Settings, ShieldAlert, User, Users } from 'lucide-react';
import { AuthScreen } from './AuthScreen';
import { HospitalsAdmin } from './components/HospitalsAdmin';
import { InventoryAdmin } from './components/InventoryAdmin';
import { NewRequestForm } from './components/NewRequestForm';
import { OperationsDashboard } from './components/OperationsDashboard';
import { RequestsOverview } from './components/RequestsOverview';
import { UserSettingsModal } from './components/UserSettingsModal';
import { UsersAdmin } from './components/UsersAdmin';
import { DEFAULT_ROLE_ACCESS, emptyAccessMap } from './permissions';
import { supabase } from './supabase';
import type { Profile, RoleAccessScope } from './types';

type AppView = 'flow' | 'requests' | 'new-request' | 'inventory' | 'hospitals' | 'users';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [view, setView] = useState<AppView>('flow');
  const [highlightedRequestId, setHighlightedRequestId] = useState('');
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [roleAccess, setRoleAccess] = useState(() => emptyAccessMap());

  useEffect(() => {
    let mounted = true;
    let loadedProfileUserId = '';

    const fetchProfile = async (userId: string) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, active')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data as Profile;
    };

    const loadProfile = async (nextSession: Session | null) => {
      if (!nextSession) {
        loadedProfileUserId = '';
        if (mounted) {
          setProfile(null);
          setProfileError('');
          setAuthLoading(false);
        }
        return;
      }

      if (mounted) {
        setProfileError('');
      }

      try {
        let data: Profile;

        try {
          data = await fetchProfile(nextSession.user.id);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, 700));
          data = await fetchProfile(nextSession.user.id);
        }

        if (!mounted) return;
        loadedProfileUserId = data.id;
        setProfile(data);
        setProfileError('');
      } catch (error) {
        if (!mounted) return;
        loadedProfileUserId = '';
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : 'Não foi possível carregar seu perfil.');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void loadProfile(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user.id || '';
      const isSameLoadedUser = Boolean(nextUserId) && nextUserId === loadedProfileUserId;

      setSession(nextSession);
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && isSameLoadedUser) {
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      void loadProfile(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadRoleAccess = async () => {
      const { data, error } = await supabase.from('role_access_scopes').select('role, access_key, enabled, updated_at');
      if (!mounted) return;

      if (error) {
        setRoleAccess(emptyAccessMap());
        return;
      }

      const nextAccess = emptyAccessMap();
      for (const row of (data || []) as RoleAccessScope[]) {
        if (row.role in nextAccess && row.access_key in nextAccess[row.role]) {
          nextAccess[row.role][row.access_key as keyof typeof nextAccess[typeof row.role]] = row.enabled;
        }
      }
      setRoleAccess(nextAccess);
    };

    void loadRoleAccess();

    const channel = supabase
      .channel('role-access-scopes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_access_scopes' }, () => void loadRoleAccess())
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true);
    window.addEventListener('logchecker-update-ready', showUpdate);
    return () => window.removeEventListener('logchecker-update-ready', showUpdate);
  }, []);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const timeout = window.setTimeout(() => setSaveNotice(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [saveNotice]);

  useEffect(() => {
    if (!profile || !profile.active || profile.role === 'pending') return;

    const access = profile.role === 'admin' ? DEFAULT_ROLE_ACCESS.admin : roleAccess[profile.role];
    const canFlow = access.view_dashboard && ['driver', 'instrumentator'].includes(profile.role);
    const canRequests = ['admin', 'office'].includes(profile.role);
    const canCreate = access.create_requests;
    const canInventory = access.manage_inventory;
    const canHospitals = access.manage_hospitals;
    const canUsers = profile.role === 'admin' || access.manage_users;

    const allowed =
      (view === 'flow' && canFlow) ||
      (view === 'requests' && canRequests) ||
      (view === 'new-request' && canCreate) ||
      (view === 'inventory' && canInventory) ||
      (view === 'hospitals' && canHospitals) ||
      (view === 'users' && canUsers);

    if (allowed) return;

    setView(canRequests ? 'requests' : canFlow ? 'flow' : canCreate ? 'new-request' : canInventory ? 'inventory' : canHospitals ? 'hospitals' : 'users');
  }, [profile, roleAccess, view]);

  const signOut = async () => {
    setAccountMenuOpen(false);
    await supabase.auth.signOut();
  };

  const handleSaved = (requestId: string) => {
    setHighlightedRequestId(requestId);
    setSaveNotice('Solicitação salva com sucesso e disponível para entrega.');
    setDashboardRefreshKey((current) => current + 1);
    setView(['admin', 'office'].includes(profile?.role || '') ? 'requests' : 'flow');
  };

  if (authLoading) {
    return (
      <main className="auth-shell">
        <div className="auth-loading">
          <LoaderCircle className="spin" size={28} />
          <span>Carregando acesso...</span>
        </div>
      </main>
    );
  }

  if (!session) return <AuthScreen />;

  if (profileError || !profile) {
    return (
      <main className="auth-shell">
        <div className="access-state">
          <ShieldAlert size={34} />
          <h1>Não foi possível carregar seu perfil</h1>
          <p>{profileError || 'Tente entrar novamente.'}</p>
          <button type="button" onClick={signOut}>Sair</button>
        </div>
      </main>
    );
  }

  if (!profile.active || profile.role === 'pending') {
    return (
      <main className="auth-shell">
        <div className="access-state">
          <ShieldAlert size={34} />
          <h1>Acesso aguardando liberação</h1>
          <p>Seu cadastro foi criado, mas um administrador ainda precisa definir sua função.</p>
          <button type="button" onClick={signOut}>Sair</button>
        </div>
      </main>
    );
  }

  const currentAccess = profile.role === 'admin' ? DEFAULT_ROLE_ACCESS.admin : roleAccess[profile.role];
  const canViewFlow = currentAccess.view_dashboard && ['driver', 'instrumentator'].includes(profile.role);
  const canViewRequests = ['admin', 'office'].includes(profile.role);
  const canCreateRequest = currentAccess.create_requests;
  const canManageInventory = currentAccess.manage_inventory;
  const canManageHospitals = currentAccess.manage_hospitals;
  const canManageUsers = profile.role === 'admin' || currentAccess.manage_users;
  const canManageWhatsapp = currentAccess.manage_whatsapp;

  return (
    <main className="app-shell operations-shell">
      <header className="topbar app-topbar">
        <img className="brand-logo" src="/logo.png" alt="LogChecker" />

        <nav className="main-navigation" aria-label="Navegação principal">
          {canViewFlow && (
            <button className={view === 'flow' ? 'active' : ''} type="button" onClick={() => setView('flow')}>
              <Route size={18} />
              <span>Fluxo</span>
            </button>
          )}
          {canViewRequests && (
            <button className={view === 'requests' ? 'active' : ''} type="button" onClick={() => setView('requests')}>
              <ListChecks size={18} />
              <span>Solicitações</span>
            </button>
          )}
          {canCreateRequest && (
            <button className={view === 'new-request' ? 'active' : ''} type="button" onClick={() => setView('new-request')}>
              <ClipboardPlus size={18} />
              <span>Nova solicitação</span>
            </button>
          )}
          {canManageInventory && (
            <button className={view === 'inventory' ? 'active' : ''} type="button" onClick={() => setView('inventory')}>
              <Archive size={18} />
              <span>Estoque</span>
            </button>
          )}
          {canManageHospitals && (
            <button className={view === 'hospitals' ? 'active' : ''} type="button" onClick={() => setView('hospitals')}>
              <Building2 size={18} />
              <span>Hospitais</span>
            </button>
          )}
          {canManageUsers && (
            <button className={view === 'users' ? 'active' : ''} type="button" onClick={() => setView('users')}>
              <Users size={18} />
              <span>Usuários</span>
            </button>
          )}
        </nav>

        <div className="account-menu">
          <span className="account-email">
            <User size={16} />
            <span>{profile.full_name || session.user.email}</span>
          </span>
          <button
            className="account-menu-trigger"
            type="button"
            onClick={() => setAccountMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label="Abrir menu da conta"
          >
            <Menu size={18} />
          </button>
          {accountMenuOpen && (
            <div className="account-dropdown" role="menu">
              <div className="account-dropdown-profile">
                <span>
                  <User size={17} />
                </span>
                <div>
                  <strong>{profile.full_name || 'Usuário LogChecker'}</strong>
                  <small>{session.user.email}</small>
                </div>
              </div>
              {canManageWhatsapp && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSettingsOpen(true);
                    setAccountMenuOpen(false);
                  }}
                >
                  <Settings size={17} />
                  <span>Configurações</span>
                </button>
              )}
              <button type="button" role="menuitem" onClick={signOut}>
                <LogOut size={17} />
                <span>Sair</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {updateAvailable && (
        <div className="update-banner" role="status">
          <span>Há uma versão nova do LogChecker disponível.</span>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('logchecker-apply-update'))}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
      )}

      {saveNotice && (
        <div className="save-notice-banner" role="status">
          <span>{saveNotice}</span>
          <button type="button" onClick={() => setSaveNotice('')} aria-label="Fechar aviso">
            Fechar
          </button>
        </div>
      )}

      {view === 'flow' && (
        <OperationsDashboard
          key={dashboardRefreshKey}
          profile={profile}
          access={currentAccess}
          highlightedRequestId={highlightedRequestId}
          refreshKey={dashboardRefreshKey}
        />
      )}
      {view === 'requests' && <RequestsOverview profile={profile} access={currentAccess} />}
      {view === 'new-request' && <NewRequestForm onSaved={handleSaved} />}
      {view === 'inventory' && <InventoryAdmin />}
      {view === 'hospitals' && <HospitalsAdmin />}
      {view === 'users' && <UsersAdmin />}
      {settingsOpen && <UserSettingsModal profile={profile} session={session} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

export default App;
