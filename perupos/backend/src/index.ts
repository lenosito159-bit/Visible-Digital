import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { evaluateAlerts } from './services/alerts.js';
import { emitPendingDocuments } from './services/pse/emitter.js';

await migrate();

const server = createApp().listen(config.PORT, () => {
  console.log(`PeruPOS API escuchando en http://localhost:${config.PORT}`);
  console.log(`Pagos QR: ${config.PAYMENTS_PROVIDER} · PSE: ${config.PSE_PROVIDER}`);
});

const timers: NodeJS.Timeout[] = [];
if (config.JOBS_ENABLED) {
  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    void fn().catch((err: Error) => console.warn(`[${name}]`, err.message));
  // Alertas del agente financiero (stock, crédito, caja, deudas, productos sin movimiento).
  timers.push(setInterval(safe('alertas', evaluateAlerts), config.ALERTS_INTERVAL_MINUTES * 60_000));
  // Reintento de comprobantes electrónicos pendientes.
  timers.push(setInterval(safe('pse', () => emitPendingDocuments()), 2 * 60_000));
  safe('alertas', evaluateAlerts)();
  safe('pse', () => emitPendingDocuments())();
}

function shutdown() {
  timers.forEach(clearInterval);
  server.close(() => void pool.end());
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
