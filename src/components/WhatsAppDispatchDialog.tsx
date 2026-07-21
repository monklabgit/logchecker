import { MessageCircle, Send, X } from 'lucide-react';

type WhatsAppDispatchDialogProps = {
  actionLabel: string;
  onCancel: () => void;
  onConfirm: (sendMessage: boolean) => void;
};

export function WhatsAppDispatchDialog({ actionLabel, onCancel, onConfirm }: WhatsAppDispatchDialogProps) {
  return (
    <div className="modal-backdrop nested" role="presentation">
      <section className="dispatch-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-confirm-title">
        <header>
          <span className="dispatch-confirm-icon" aria-hidden="true">
            <MessageCircle size={22} />
          </span>
          <div>
            <p className="eyebrow">WhatsApp</p>
            <h2 id="dispatch-confirm-title">Disparar mensagem no grupo?</h2>
            <p>{actionLabel} será concluída de qualquer forma.</p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Cancelar confirmação">
            <X size={19} />
          </button>
        </header>
        <div className="dispatch-confirm-actions">
          <button className="secondary-button" type="button" onClick={() => onConfirm(false)}>
            Não, apenas concluir
          </button>
          <button className="card-action-button" type="button" onClick={() => onConfirm(true)}>
            <Send size={16} />
            Sim, concluir e disparar
          </button>
        </div>
      </section>
    </div>
  );
}
