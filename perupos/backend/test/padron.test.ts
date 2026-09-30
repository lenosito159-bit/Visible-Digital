import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importPadron, parsePadronLine } from '../src/scripts/import-padron.js';
import { api, pool, resetDb, tokens } from './helpers.js';

let t: Awaited<ReturnType<typeof tokens>>;

beforeAll(async () => {
  await resetDb();
  t = await tokens();
});

afterAll(async () => {
  await pool.end();
});

// Líneas con el formato del Padrón Reducido (16 columnas con "|" final, Latin-1).
// Los RUC son de ejemplo con dígito verificador válido; los nombres son inventados.
const SAMPLE = [
  'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|TIPO DE VÍA|NOMBRE DE VÍA|CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILÓMETRO|',
  '20100070970|DISTRIBUIDORA EJEMPLO S.A.C.|ACTIVO|HABIDO|150101|AV.|LAS FLORES|-|-|123|-|-|-|-|-|',
  '20123456786|INVERSIONES DOÑA ROSA E.I.R.L.|ACTIVO|HABIDO|150132|JR.|LAS MAGNOLIAS|-|-|245|-|-|-|-|-|',
  '10456789124|QUISPE MAMANI ROSA|BAJA DE OFICIO|NO HABIDO|150132|-|-|-|-|-|-|-|-|-|-|',
  'línea rota sin columnas',
].join('\n');

describe('padrón SUNAT', () => {
  it('sin padrón cargado, el RUC queda "no verificado" (pero con formato validado)', async () => {
    const res = await api.get('/ruc/20100070970', t.vendedor);
    expect(res.body).toMatchObject({ validFormat: true, source: 'NO_VERIFICADO', found: false });
    expect(res.body.message).toContain('no verificado');
    const bad = await api.get('/ruc/20100070971', t.vendedor);
    expect(bad.body).toMatchObject({ validFormat: false, ok: false });
  });

  it('lee las líneas del padrón y salta la cabecera y las rotas', () => {
    const lines = SAMPLE.split('\n');
    expect(parsePadronLine(lines[0]!)).toBeNull();
    expect(parsePadronLine(lines[3]!)).toEqual({
      ruc: '10456789124',
      razonSocial: 'QUISPE MAMANI ROSA',
      estado: 'BAJA DE OFICIO',
      condicion: 'NO HABIDO',
      ubigeo: '150132',
    });
    expect(parsePadronLine(lines[4]!)).toBeNull();
  });

  it('importa el archivo en Latin-1 y consulta activo/habido, baja y no encontrado', async () => {
    const file = join(tmpdir(), `padron-${Date.now()}.txt`);
    writeFileSync(file, Buffer.from(SAMPLE, 'latin1'));
    const result = await importPadron(file, () => {});
    expect(result).toEqual({ rows: 3, skipped: 2 });

    const ok = await api.get('/ruc/20123456786', t.vendedor);
    expect(ok.body).toMatchObject({ source: 'PADRON', found: true, ok: true, razonSocial: 'INVERSIONES DOÑA ROSA E.I.R.L.' });
    const baja = await api.get('/ruc/10456789124', t.vendedor);
    expect(baja.body).toMatchObject({ found: true, ok: false, estado: 'BAJA DE OFICIO', condicion: 'NO HABIDO' });
    const missing = await api.get('/ruc/20600000005', t.vendedor);
    expect(missing.body).toMatchObject({ validFormat: true, source: 'PADRON', found: false, ok: false });
  });
});
