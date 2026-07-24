import { MessageCircle, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export type KitControlDispatchMode = 'pending' | 'current' | 'all';

type KitControlDispatchDialogProps = {
  pendingCount: number;
  currentCount: number;
  totalCount: number;
  onCancel: () => void;
  onConfirm: (mode: KitControlDispatchMode) => void;
};

export function KitControlDispatchDialog({
  pendingCount,
  currentCount,
  totalCount,
  onCancel,
  onConfirm,
}: KitControlDispatchDialogProps) {
  const recommendedMode: KitControlDispatchMode = pendingCount ? 'pending' : 'all';
  const [mode, setMode] = useState<KitControlDispatchMode>(recommendedMode);

  useEffect(() => {
    setMode(recommendedMode);
  }, [recommendedMode]);

  const options: Array<{ mode: KitControlDispatchMode; title: string; description: string; count: number }> = [
    {
      mode: 'pending',
      title: 'Enviar Pendentes',
      description: 'Inclui todas as fotos que nunca foram enviadas, mesmo as salvas anteriormente.',
      count: pendingCount,
    },
    {
      mode: 'current',
      title: 'Somente Adicionadas Agora',
      description: 'Envia apenas as fotos salvas nesta etapa.',
      count: currentCount,
    },
    {
      mode: 'all',
      title: 'Enviar Todas',
      description: 'Reenvia o conjunto completo do Controle de Kits.',
      count: totalCount,
    },
  ];

  return (
    <div className="modal-backdrop nested" role="presentation">
      <section className="dispatch-confirm-modal kit-dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="kit-dispatch-title">
        <header>
          <span className="dispatch-confirm-icon" aria-hidden="true"><MessageCircle size={22} /></span>
          <div>
            <p className="eyebrow">WhatsApp</p>
            <h2 id="kit-dispatch-title">Envio para Conferência de Kits</h2>
            <p>As fotos já estão salvas. Escolha quais evidências devem seguir para o grupo.</p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Não enviar agora">
            <X size={19} />
          </button>
        </header>

        <div className="kit-dispatch-options">
          {options.map((option) => (
            <label className={mode === option.mode ? 'selected' : ''} key={option.mode}>
              <input
                type="radio"
                name="kit-dispatch-mode"
                value={option.mode}
                checked={mode === option.mode}
                disabled={!option.count}
                onChange={() => setMode(option.mode)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
              <b>{option.count}</b>
            </label>
          ))}
        </div>

        <div className="dispatch-confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Não enviar agora</button>
          <button className="card-action-button" type="button" onClick={() => onConfirm(mode)} disabled={!options.find((option) => option.mode === mode)?.count}>
            <Send size={16} />
            Enviar evidências
          </button>
        </div>
      </section>
    </div>
  );
}
