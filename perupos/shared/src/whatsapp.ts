import { formatSoles } from './money.js';
import type { Cents } from './types.js';
import { normalizePeruMobile } from './validators.js';

/** Enlace wa.me que abre WhatsApp con el mensaje escrito. null si el teléfono no es válido. */
export function whatsappLink(phone: string, text: string): string | null {
  const normalized = normalizePeruMobile(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

/** Enlace para elegir el contacto en WhatsApp (cuando el cliente no tiene teléfono guardado). */
export function whatsappShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Recordatorio de deuda: cordial, corto y con el monto exacto. */
export function debtReminderMessage(params: {
  customerName: string;
  balanceCents: Cents;
  businessName: string;
  days?: number;
}): string {
  const firstName = params.customerName.trim().split(/\s+/)[0] ?? params.customerName;
  const since = params.days && params.days > 0 ? ` desde hace ${params.days} días` : '';
  return (
    `Hola ${firstName}, te saluda ${params.businessName}. ` +
    `Te recordamos que tienes un saldo pendiente de ${formatSoles(params.balanceCents)}${since}. ` +
    `Puedes pagar en la tienda en efectivo, Yape o Plin. ¡Gracias por tu preferencia!`
  );
}
