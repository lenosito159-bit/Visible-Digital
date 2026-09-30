import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { errorHandler } from './http/errors.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { customersRouter } from './routes/customers.js';
import { financeRouter } from './routes/finance.js';
import { salesRouter } from './routes/sales.js';
import { syncRouter } from './routes/sync.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',') }));
  // Comprime las respuestas (con 1,000 productos el catálogo baja de ~290 KB a ~35 KB): cuida los datos del plan prepago.
  app.use(compression());

  // Los webhooks se verifican con el cuerpo crudo: no pasan por el parser JSON.
  const json = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path.startsWith('/webhooks/') ? next() : json(req, res, next)));

  app.use('/uploads', express.static(config.UPLOAD_DIR, { maxAge: '7d', fallthrough: false }));

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'perupos', time: new Date().toISOString() });
  });

  app.use('/auth', authRouter);
  app.use(salesRouter);
  app.use(adminRouter);
  app.use(catalogRouter);
  app.use(customersRouter);
  app.use(financeRouter);
  app.use(syncRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada.', code: 'NO_ENCONTRADO' });
  });
  app.use(errorHandler);
  return app;
}
