// Ejemplo completo contra JSONPlaceholder, una API pública de pruebas.
// Úsalo como plantilla para escribir los tests de tus propias APIs.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClient } from '../../src/api-client.js';

const api = createClient({ baseUrl: 'https://jsonplaceholder.typicode.com' });

// Contrato esperado de un "post": si la API cambia su forma, el test falla.
const PostSchema = z.object({
  userId: z.number().int().positive(),
  id: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string(),
});

const CommentSchema = z.object({
  postId: z.number().int().positive(),
  id: z.number().int().positive(),
  name: z.string(),
  email: z.email(),
  body: z.string(),
});

describe('JSONPlaceholder /posts', () => {
  it('GET /posts devuelve la lista completa con el formato correcto', async () => {
    const res = await api.get('/posts');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.data).toHaveLength(100);
    z.array(PostSchema).parse(res.data);
  });

  it('GET /posts/1 devuelve un post concreto', async () => {
    const res = await api.get('/posts/1');

    expect(res.status).toBe(200);
    expect(PostSchema.parse(res.data)).toMatchObject({ id: 1, userId: 1 });
  });

  it('GET /posts?userId=1 filtra por usuario', async () => {
    const res = await api.get('/posts', { query: { userId: 1 } });

    expect(res.status).toBe(200);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((post) => post.userId === 1)).toBe(true);
  });

  it('GET /posts/1/comments devuelve comentarios válidos', async () => {
    const res = await api.get('/posts/1/comments');

    expect(res.status).toBe(200);
    const comments = z.array(CommentSchema).parse(res.data);
    expect(comments.every((comment) => comment.postId === 1)).toBe(true);
  });

  it('GET de un recurso inexistente devuelve 404', async () => {
    const res = await api.get('/posts/999999');

    expect(res.status).toBe(404);
  });

  it('POST /posts crea un post', async () => {
    const nuevo = { title: 'Hola', body: 'Creado desde un test', userId: 1 };
    const res = await api.post('/posts', nuevo);

    expect(res.status).toBe(201);
    expect(res.data).toMatchObject(nuevo);
    expect(res.data.id).toEqual(expect.any(Number));
  });

  it('PUT /posts/1 reemplaza un post', async () => {
    const actualizado = { id: 1, title: 'Nuevo título', body: 'Nuevo cuerpo', userId: 1 };
    const res = await api.put('/posts/1', actualizado);

    expect(res.status).toBe(200);
    expect(res.data).toEqual(actualizado);
  });

  it('PATCH /posts/1 modifica solo los campos enviados', async () => {
    const res = await api.patch('/posts/1', { title: 'Solo cambia el título' });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ id: 1, title: 'Solo cambia el título' });
  });

  it('DELETE /posts/1 responde 200', async () => {
    const res = await api.delete('/posts/1');

    expect(res.status).toBe(200);
  });

  it('responde en menos de 5 segundos', async () => {
    const res = await api.get('/posts/1');

    expect(res.durationMs).toBeLessThan(5_000);
  });
});
