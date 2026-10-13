import { allocate, type BusinessSettings, type Sale } from '@perupos/shared';
import type { PseProvider, PseResult } from './provider.js';

type Json = Record<string, any>;

const TIPO_COMPROBANTE: Partial<Record<Sale['docType'], number>> = { FACTURA: 1, BOLETA: 2 };
const TIPO_DOC_CLIENTE: Record<string, string> = { RUC: '6', DNI: '1', CE: '4' };
const TIPO_IGV: Record<string, number> = { GRAVADO: 1, EXONERADO: 8, INAFECTO: 9 };

const money = (cents: number) => Number((cents / 100).toFixed(2));

/** dd-mm-aaaa en hora de Lima. */
function fecha(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/**
 * Emisión de boletas y facturas electrónicas con la API JSON de Nubefact.
 * NUBEFACT_URL es la "RUTA" y NUBEFACT_TOKEN el "TOKEN" que Nubefact entrega
 * al activar la integración. Revisa su documentación vigente antes de producción.
 *
 * Ticket POS (Nuevo RUS, SEE-CF) requiere un PSE-CF autorizado: este adaptador
 * lo rechaza para que no se emita un comprobante con el tipo equivocado.
 */
export class NubefactPse implements PseProvider {
  readonly name = 'nubefact';

  constructor(
    private url: string,
    private token: string,
  ) {}

  async emit(sale: Sale, _business: BusinessSettings): Promise<PseResult> {
    const tipo = TIPO_COMPROBANTE[sale.docType];
    if (!tipo) {
      return {
        status: 'ERROR',
        message: 'Nubefact no emite este tipo de comprobante. Para Ticket POS (Nuevo RUS) configura un PSE-CF.',
        qr: null,
        hash: null,
        pdfUrl: null,
        raw: null,
      };
    }
    return this.send(this.buildDocument(sale, tipo));
  }

  async status(sale: Sale): Promise<PseResult> {
    return this.send({
      operacion: 'consultar_comprobante',
      tipo_de_comprobante: TIPO_COMPROBANTE[sale.docType],
      serie: sale.serie,
      numero: sale.correlativo,
    });
  }

  async void(sale: Sale, _business: BusinessSettings, reason: string): Promise<PseResult> {
    return this.send({
      operacion: 'generar_anulacion',
      tipo_de_comprobante: TIPO_COMPROBANTE[sale.docType],
      serie: sale.serie,
      numero: sale.correlativo,
      motivo: reason.slice(0, 100),
      codigo_unico: '',
    });
  }

  buildDocument(sale: Sale, tipo: number): Json {
    const hasBuyer = !!sale.buyerDocNumber && !!sale.buyerDocType && sale.buyerDocType !== 'NONE';
    // El descuento global ya está repartido en cada línea: se envían precios finales.
    const discountShare = allocate(sale.discountCents, sale.items.map((i) => i.totalCents));
    const items = sale.items.map((item, i) => {
      const total = item.totalCents - (discountShare[i] ?? 0);
      const igv = item.igvCents;
      const base = total - igv;
      return {
        unidad_de_medida: item.unit === 'KG' ? 'KGM' : 'NIU',
        codigo: item.productId.slice(0, 30),
        descripcion: item.name,
        cantidad: item.quantity,
        valor_unitario: Number((base / 100 / item.quantity).toFixed(10)),
        precio_unitario: Number((total / 100 / item.quantity).toFixed(10)),
        subtotal: money(base),
        tipo_de_igv: TIPO_IGV[item.taxAffectation] ?? 1,
        igv: money(igv),
        total: money(total),
        anticipo_regularizacion: false,
      };
    });
    return {
      operacion: 'generar_comprobante',
      tipo_de_comprobante: tipo,
      serie: sale.serie,
      numero: sale.correlativo,
      sunat_transaction: 1,
      cliente_tipo_de_documento: hasBuyer ? TIPO_DOC_CLIENTE[sale.buyerDocType!] : '-',
      cliente_numero_de_documento: hasBuyer ? sale.buyerDocNumber : '-',
      cliente_denominacion: hasBuyer ? sale.buyerName : 'CLIENTES VARIOS',
      cliente_direccion: '',
      cliente_email: '',
      fecha_de_emision: fecha(sale.createdAt),
      moneda: 1,
      porcentaje_de_igv: 18.0,
      total_gravada: money(sale.gravadaCents),
      total_exonerada: money(sale.exoneradaCents),
      total_inafecta: money(sale.inafectaCents),
      total_igv: money(sale.igvCents),
      total: money(sale.totalCents),
      enviar_automaticamente_a_la_sunat: true,
      enviar_automaticamente_al_cliente: false,
      items,
    };
  }

  private async send(body: Json): Promise<PseResult> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { Authorization: `Token token="${this.token}"`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return { status: 'ERROR', message: `Sin conexión con Nubefact: ${(err as Error).message}`, qr: null, hash: null, pdfUrl: null, raw: null };
    }
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok || data.errors) {
      return {
        status: 'ERROR',
        message: String(data.errors ?? `Nubefact respondió ${res.status}`),
        qr: null,
        hash: null,
        pdfUrl: null,
        raw: data,
      };
    }
    const rejected = data.sunat_responsecode && String(data.sunat_responsecode) !== '0';
    return {
      status: data.aceptada_por_sunat ? 'ACEPTADO' : rejected ? 'RECHAZADO' : 'PENDIENTE',
      message: String(data.sunat_description ?? 'Enviado al PSE.'),
      qr: data.cadena_para_codigo_qr ?? null,
      hash: data.codigo_hash ?? null,
      pdfUrl: data.enlace_del_pdf ?? null,
      raw: data,
    };
  }
}
