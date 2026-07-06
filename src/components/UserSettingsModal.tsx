import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LoaderCircle, MessageCircle, PlugZap, QrCode, Unplug, UsersRound, X } from 'lucide-react';
import type { Profile, UserWhatsappConnection } from '../types';

type UserSettingsModalProps = {
  profile: Profile;
  session: Session;
  onClose: () => void;
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

export function UserSettingsModal({ profile, session, onClose }: UserSettingsModalProps) {
  const [connection, setConnection] = useState<UserWhatsappConnection | null>(null);
  const [qrcode, setQrcode] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  const state = connection?.connection_state || 'not_configured';

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <div>
            <p className="eyebrow">conta</p>
            <h2 id="settings-title">Configurações</h2>
            <span>{profile.full_name || session.user.email}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar configurações">
            <X size={20} />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
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

                {connection?.group_jid && (
                  <div className="whatsapp-group-summary">
                    <UsersRound size={18} />
                    <span>
                      <strong>{connection.group_name || 'Grupo de logística'}</strong>
                      <small>{connection.group_jid}</small>
                    </span>
                  </div>
                )}
              </>
            )}

            {error && <p className="auth-message error">{error}</p>}
            {notice && <p className="auth-message notice">{notice}</p>}
          </section>
        </div>
      </section>
    </div>
  );
}
