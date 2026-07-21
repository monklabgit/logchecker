import { supabase } from './supabase';

type WhatsAppEventType = 'delivery_completed' | 'release_completed' | 'pickup_completed' | 'kit_control';

export const notifyWhatsAppOperation = async (requestId: string, eventType: WhatsAppEventType, photoPaths: string[] = []) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente para enviar a mensagem.');

  const response = await fetch('/api/evolution/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'notify_operation',
      requestId,
      eventType,
      photoPaths,
    }),
  });

  const payload = (await response.json().catch(() => null)) as { error?: string; skipped?: boolean; reason?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Não foi possível enviar a mensagem no WhatsApp.');
  }
  if (payload?.skipped) {
    throw new Error(payload.reason || 'A mensagem não foi enviada porque o WhatsApp está desconectado.');
  }
};

export const notifyWhatsAppKitControl = async (requestId: string, photoPaths: string[]) =>
  notifyWhatsAppOperation(requestId, 'kit_control', photoPaths);
