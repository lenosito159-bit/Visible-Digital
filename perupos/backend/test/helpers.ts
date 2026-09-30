import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { SaleInput } from '@perupos/shared';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';

export const app = createApp();

/** Base de datos limpia con el seed base (20 productos, 3 usuarios, 4 clientes). */
export async function resetDb(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed({ log: () => {} });
}

export async function login(username: string, secret: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ username, secret });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}

export async function tokens() {
  return {
    admin: await login('admin', '1234'),
    vendedor: await login('carlos', '1111'),
    agente: await login('lucia', '2222'),
  };
}

export const api = {
  get: (path: string, token: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path: string, token: string, body: object = {}) =>
    request(app).post(path).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, token: string, body: object) =>
    request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body),
};

export async function product(nameLike: string) {
  const res = await pool.query('SELECT * FROM products WHERE name ILIKE $1', [`%${nameLike}%`]);
  return res.rows[0];
}

export async function customer(nameLike: string) {
  const res = await pool.query('SELECT * FROM customers WHERE name ILIKE $1', [`%${nameLike}%`]);
  return res.rows[0];
}

export function saleInput(overrides: Partial<SaleInput> & Pick<SaleInput, 'items' | 'payments'>): SaleInput {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    discountCents: 0,
    customerId: null,
    docType: 'TICKET',
    ...overrides,
  };
}

export { pool, randomUUID };
