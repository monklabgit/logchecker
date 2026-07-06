import { supabase } from './supabase';

type WhatsAppEventType = 'delivery_completed' | 'release_completed' | 'pickup_completed';

export const notifyWhatsAppOperation = async (requestId: string, eventType: WhatsAppEventType, photoPaths: string[] = []) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;

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

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || 'Não foi possível enviar a mensagem no WhatsApp.');
  }
};
