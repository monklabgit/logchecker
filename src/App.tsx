import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Building2, ClipboardPlus, LayoutDashboard, LoaderCircle, LogOut, Menu, RefreshCw, Settings, ShieldAlert, User } from 'lucide-react';
import { AuthScreen } from './AuthScreen';
import { HospitalsAdmin } from './components/HospitalsAdmin';
import { NewRequestForm } from './components/NewRequestForm';
import { OperationsDashboard } from './components/OperationsDashboard';
import { UserSettingsModal } from './components/UserSettingsModal';
import { supabase } from './supabase';
import type { Profile } from './types';

type AppView = 'dashboard' | 'new-request' | 'hospitals';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [view, setView] = useState<AppView>('dashboard');
  const [highlightedRequestId, setHighlightedRequestId] = useState('');
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadProfile = async (nextSession: Session | null) => {
      if (!nextSession) {
        if (mounted) {
          setProfile(null);
          setAuthLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, active')
        .eq('id', nextSession.user.id)
        .single();

      if (!mounted) return;
      if (error) setProfileError(error.message);
      else setProfile(data as Profile);
      setAuthLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void loadProfile(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(true);
      void loadProfile(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
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

  const signOut = async () => {
    setAccountMenuOpen(false);
    await supabase.auth.signOut();
  };

  const handleSaved = (requestId: string) => {
    setHighlightedRequestId(requestId);
    setSaveNotice('Solicitação salva com sucesso e disponível para entrega.');
    setDashboardRefreshKey((current) => current + 1);
    setView('dashboard');
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

  const canCreateRequest = ['admin', 'office'].includes(profile.role);
  const canManageHospitals = profile.role === 'admin';

  return (
    <main className="app-shell operations-shell">
      <header className="topbar app-topbar">
        <img className="brand-logo" src="/logo.png" alt="LogChecker" />

        <nav className="main-navigation" aria-label="Navegação principal">
          <button className={view === 'dashboard' ? 'active' : ''} type="button" onClick={() => setView('dashboard')}>
            <LayoutDashboard size={18} />
            <span>Painel</span>
          </button>
          {canCreateRequest && (
            <button className={view === 'new-request' ? 'active' : ''} type="button" onClick={() => setView('new-request')}>
              <ClipboardPlus size={18} />
              <span>Nova solicitação</span>
            </button>
          )}
          {canManageHospitals && (
            <button className={view === 'hospitals' ? 'active' : ''} type="button" onClick={() => setView('hospitals')}>
              <Building2 size={18} />
              <span>Hospitais</span>
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

      {view === 'dashboard' && (
        <OperationsDashboard
          key={dashboardRefreshKey}
          profile={profile}
          highlightedRequestId={highlightedRequestId}
          refreshKey={dashboardRefreshKey}
        />
      )}
      {view === 'new-request' && <NewRequestForm onSaved={handleSaved} />}
      {view === 'hospitals' && <HospitalsAdmin />}
      {settingsOpen && <UserSettingsModal profile={profile} session={session} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

export default App;
