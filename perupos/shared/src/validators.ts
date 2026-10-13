/**
 * RUC peruano: 11 dígitos, empieza en 10 (persona natural), 15, 16, 17 o 20
 * (persona jurídica), y el último dígito es verificador (módulo 11).
 */
export function isValidRuc(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(ruc[i]), 0);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(ruc[10]);
}

export function isValidDni(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

/** Carné de extranjería: hasta 12 caracteres alfanuméricos. */
export function isValidCe(ce: string): boolean {
  return /^[A-Za-z0-9]{8,12}$/.test(ce);
}

/** EAN-13 con dígito verificador (código de barras de productos). */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

/**
 * Normaliza un celular peruano al formato internacional sin "+": "51987654321".
 * Acepta "987 654 321", "+51 987654321", "0051987654321". Devuelve null si no es un celular.
 */
export function normalizePeruMobile(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0051')) digits = digits.slice(4);
  else if (digits.startsWith('51') && digits.length === 11) digits = digits.slice(2);
  if (!/^9\d{8}$/.test(digits)) return null;
  return `51${digits}`;
}
