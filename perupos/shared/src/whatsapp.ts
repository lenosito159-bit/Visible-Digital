import { formatSoles } from './money.js';
import type { Cents, CustomerTreatment } from './types.js';
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

// En el Perú se escribe "setiembre" (así lo usa también la RAE como variante válida).
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

/** Fecha de Lima en palabras: "12 de setiembre". */
export function fechaPe(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** Palabras que el tendero ya pudo haber escrito en el nombre ("Señora Carmen", "Don Lucho"). */
const HONORIFICS = /^(don|doña|dona|sr\.?|sra\.?|señor|señora|srta\.?|señorita|tío|tía|vecin[oa]|caser[oa]|profe)\b/i;

/**
 * Cómo saludar al cliente. Si el nombre ya trae un trato ("Señora Carmen") se
 * respeta tal cual; si no, se usa el trato elegido en su ficha. Nunca se
 * adivina "Don" o "Doña" por el nombre: lo elige el tendero.
 */
export function customerGreetingName(name: string, trato: CustomerTreatment = null): string {
  const clean = name.trim().replace(/\s*\(.*\)\s*$/, '');
  if (HONORIFICS.test(clean)) return clean.split(/\s+/).slice(0, 2).join(' ');
  const first = clean.split(/\s+/)[0] ?? clean;
  if (trato === 'DON') return `Don ${first}`;
  if (trato === 'DONA') return `Doña ${first}`;
  return first;
}

export const REMINDER_TEMPLATES = ['AMABLE', 'QUINCENA', 'FIN_DE_MES', 'SEGUNDO_AVISO'] as const;
export type ReminderTemplate = (typeof REMINDER_TEMPLATES)[number];

export const REMINDER_TEMPLATE_LABELS: Record<ReminderTemplate, string> = {
  AMABLE: 'Amable',
  QUINCENA: 'Quincena',
  FIN_DE_MES: 'Fin de mes',
  SEGUNDO_AVISO: 'Segundo aviso',
};

export interface ReminderInput {
  customerName: string;
  trato?: CustomerTreatment;
  balanceCents: Cents;
  businessName: string;
  /** Fecha del fiado pendiente más antiguo. */
  since?: string | null;
  template?: ReminderTemplate;
}

/**
 * Recordatorio de fiado por WhatsApp. Tono respetuoso de bodega: se trata de
 * "usted", sin amenazas ni palabras de banco. El tendero no quiere perder al cliente.
 */
export function debtReminderMessage(input: ReminderInput): string {
  const who = customerGreetingName(input.customerName, input.trato ?? null);
  const amount = formatSoles(input.balanceCents);
  const since = input.since ? ` desde el ${fechaPe(input.since)}` : '';
  const firma = `Gracias, ${input.businessName}.`;
  // "Aquí lo/la espero" solo si el tendero eligió Don/Doña; si no, una frase sin género.
  const espera =
    input.trato === 'DON' ? 'aquí lo espero' : input.trato === 'DONA' ? 'aquí la espero' : 'pase nomás por la tienda';
  switch (input.template ?? 'AMABLE') {
    case 'QUINCENA':
      return `Hola ${who}, buen día. Por la quincena le recuerdo su cuenta en la tienda: ${amount}${since}. Cuando pueda, ${espera}. ${firma}`;
    case 'FIN_DE_MES':
      return `Hola ${who}, buen día. Ya es fin de mes y le recuerdo su cuenta: ${amount}${since}. Puede pagar en efectivo, Yape o Plin, y si prefiere, en partes. ${firma}`;
    case 'SEGUNDO_AVISO':
      return `${who}, disculpe la molestia. Le escribo otra vez por su cuenta de ${amount}${since}. Si le queda mejor abonar una parte, no hay problema, conversamos. ${firma}`;
    default:
      return `${who}, le recuerdo su cuenta: ${amount}${since}. Cuando pueda, ${espera}. ${firma}`;
  }
}

export type Payday = { kind: 'QUINCENA' | 'FIN_DE_MES'; label: string } | null;

/**
 * Días en que la gente cobra su sueldo: quincena (14 al 16) y fin de mes
 * (últimos 2 días y el día 1). Son los mejores días para cobrar fiados.
 */
export function paydayInfo(now: Date = new Date()): Payday {
  const lima = new Date(now.getTime() - 5 * 3_600_000);
  const day = lima.getUTCDate();
  const lastDay = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth() + 1, 0)).getUTCDate();
  if (day >= 14 && day <= 16) return { kind: 'QUINCENA', label: 'Es quincena: buen día para cobrar los fiados.' };
  if (day >= lastDay - 1 || day === 1) return { kind: 'FIN_DE_MES', label: 'Es fin de mes: buen día para cobrar los fiados.' };
  return null;
}
