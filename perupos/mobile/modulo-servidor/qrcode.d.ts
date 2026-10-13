// Tipos mínimos de "qrcode" (la usa react-native-qrcode-svg); solo usamos create().
declare module 'qrcode' {
  export interface QRCodeModel {
    modules: { size: number; get(row: number, col: number): boolean | number };
  }
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): QRCodeModel;
  const QRCode: { create: typeof create };
  export default QRCode;
}
