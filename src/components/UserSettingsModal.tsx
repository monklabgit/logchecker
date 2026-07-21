import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LoaderCircle, MessageCircle, PlugZap, QrCode, Save, Unplug, UsersRound } from 'lucide-react';
import type { Profile, UserWhatsappConnection } from '../types';

type UserSettingsPageProps = {
  profile: Profile;
  session: Session;
};

type WhatsappResponse = {
  connection?: UserWhatsappConnection | null;
  state?: string;
  qrcode?: string;
  error?: string;
};

const stateLabels: Record<string, string> = {
  open: 'Conectado',
  close: 'Desconectado',
  connecting: 'Aguardando QR',
  not_configured: 'Não configurado',
};

export function UserSettingsPage({ profile, session }: UserSettingsPageProps) {
  const [connection, setConnection] = useState<UserWhatsappConnection | null>(null);
  const [qrcode, setQrcode] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logisticsGroupJid, setLogisticsGroupJid] = useState('');
  const [logisticsGroupName, setLogisticsGroupName] = useState('');
  const [kitControlGroupJid, setKitControlGroupJid] = useState('');
  const [kitControlGroupName, setKitControlGroupName] = useState('');

  const callWhatsapp = async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/evolution/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as WhatsappResponse | null;
    if (!response.ok) throw new Error(data?.error || 'Não foi possível falar com a Evolution.');
    return data || {};
  };

  const applyConnection = (nextConnection?: UserWhatsappConnection | null) => {
    if (typeof nextConnection === 'undefined') return;
    setConnection(nextConnection);
    if (!nextConnection) return;
    setLogisticsGroupJid(nextConnection.group_jid || '');
    setLogisticsGroupName(nextConnection.group_name || '');
    setKitControlGroupJid(nextConnection.kit_control_group_jid || '');
    setKitControlGroupName(nextConnection.kit_control_group_name || '');
  };

  const loadStatus = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const data = await callWhatsapp({ action: 'status' });
      applyConnection(data.connection);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar o WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const connectWhatsapp = async () => {
    setActing('connect');
    setError('');
    setNotice('');
    try {
      const data = await callWhatsapp({ action: 'connect' });
      applyConnection(data.connection);
      setQrcode(data.qrcode || '');
      setNotice('QR Code gerado. Escaneie com o WhatsApp e depois atualize o status.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível gerar o QR Code.');
    } finally {
      setActing('');
    }
  };

  const logoutWhatsapp = async () => {
    setActing('logout');
    setError('');
    setNotice('');
    try {
      const data = await callWhatsapp({ action: 'logout' });
      applyConnection(data.connection);
      setQrcode('');
      setNotice('WhatsApp desconectado.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível desconectar.');
    } finally {
      setActing('');
    }
  };

  const saveGroups = async () => {
    setActing('save-groups');
    setError('');
    setNotice('');
    try {
      const data = await callWhatsapp({
        action: 'save_groups',
        logisticsGroupJid,
        logisticsGroupName,
        kitControlGroupJid,
        kitControlGroupName,
      });
      applyConnection(data.connection);
      setNotice('Grupos do WhatsApp atualizados.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar os grupos.');
    } finally {
      setActing('');
    }
  };

  const state = connection?.connection_state || 'not_configured';

  return (
    <section className="settings-view" aria-labelledby="settings-title">
      <header className="settings-page-header">
        <div>
          <p className="eyebrow">Conta</p>
          <h1 id="settings-title">Configurações</h1>
          <span>{profile.full_name || session.user.email}</span>
        </div>
      </header>

      <div className="settings-page-content">
        <section className="settings-section settings-page-section">
            <div className="settings-section-title">
              <MessageCircle size={20} />
              <div>
                <h3>WhatsApp</h3>
                <p>Conecte seu próprio WhatsApp para disparos pelo LogChecker.</p>
              </div>
            </div>

            {loading ? (
              <div className="settings-loading">
                <LoaderCircle className="spin" size={22} />
                Carregando WhatsApp...
              </div>
            ) : (
              <>
                <div className={`whatsapp-status state-${state}`}>
                  <span />
                  <strong>{stateLabels[state] || state}</strong>
                  {connection?.instance_name && <small>{connection.instance_name}</small>}
                </div>

                <div className="settings-actions">
                  <button type="button" onClick={connectWhatsapp} disabled={Boolean(acting)}>
                    {acting === 'connect' ? <LoaderCircle className="spin" size={17} /> : <QrCode size={17} />}
                    Gerar QR Code
                  </button>
                  <button type="button" onClick={() => void loadStatus(true)} disabled={Boolean(acting)}>
                    <PlugZap size={17} />
                    Atualizar status
                  </button>
                  {connection && (
                    <button type="button" onClick={logoutWhatsapp} disabled={Boolean(acting)}>
                      {acting === 'logout' ? <LoaderCircle className="spin" size={17} /> : <Unplug size={17} />}
                      Desconectar
                    </button>
                  )}
                </div>

                {qrcode && (
                  <div className="qr-panel">
                    <img src={qrcode} alt="QR Code do WhatsApp" />
                    <p>Abra o WhatsApp no celular, acesse aparelhos conectados e escaneie este QR Code.</p>
                  </div>
                )}

                <div className="whatsapp-group-settings">
                  <div className="whatsapp-group-settings-title">
                    <UsersRound size={18} />
                    <div>
                      <strong>Grupos de disparo</strong>
                      <span>Defina um destino para a logística e outro para a Conferência de Kits.</span>
                    </div>
                  </div>
                  <div className="whatsapp-groups-grid">
                    <div className="whatsapp-group-fields">
                      <h4>Logística</h4>
                      <label>
                        <span>Nome do grupo</span>
                        <input value={logisticsGroupName} onChange={(event) => setLogisticsGroupName(event.target.value)} placeholder="Ex.: Marja Logística Rio" />
                      </label>
                      <label>
                        <span>ID do grupo</span>
                        <input value={logisticsGroupJid} onChange={(event) => setLogisticsGroupJid(event.target.value)} placeholder="120000000000000000@g.us" autoCapitalize="none" />
                      </label>
                    </div>
                    <div className="whatsapp-group-fields">
                      <h4>Conferência de Kits</h4>
                      <label>
                        <span>Nome do grupo</span>
                        <input value={kitControlGroupName} onChange={(event) => setKitControlGroupName(event.target.value)} placeholder="Ex.: Conferência de Kits" />
                      </label>
                      <label>
                        <span>ID do grupo</span>
                        <input value={kitControlGroupJid} onChange={(event) => setKitControlGroupJid(event.target.value)} placeholder="120000000000000000@g.us" autoCapitalize="none" />
                      </label>
                    </div>
                  </div>
                  <button className="save-whatsapp-groups-button" type="button" onClick={() => void saveGroups()} disabled={Boolean(acting)}>
                    {acting === 'save-groups' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
                    Salvar grupos
                  </button>
                </div>
              </>
            )}

            {error && <p className="auth-message error">{error}</p>}
            {notice && <p className="auth-message notice">{notice}</p>}
        </section>
      </div>
    </section>
  );
}
