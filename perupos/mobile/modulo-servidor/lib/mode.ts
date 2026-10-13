/**
 * La app funciona completa en el celular. El servidor (sincronizar, Yape
 * verificado por TAYPI, comprobantes SUNAT) es un módulo opcional para el
 * futuro: queda apagado salvo que se construya la app con
 * EXPO_PUBLIC_SERVER_ENABLED=true. Apagado, la app no envía nada a internet.
 */
export const SERVER_ENABLED = process.env.EXPO_PUBLIC_SERVER_ENABLED === 'true';
