-- PeruPOS: esquema inicial.
-- Montos en céntimos (integer). Cantidades en numeric(12,3) para vender a granel (kilos).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Datos del negocio (una sola fila).
CREATE TABLE business_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ruc char(11) NOT NULL,
  razon_social text NOT NULL,
  nombre_comercial text NOT NULL DEFAULT '',
  direccion text NOT NULL,
  ubigeo char(6),
  phone text,
  tax_regime text NOT NULL CHECK (tax_regime IN ('NRUS', 'RER', 'RMT', 'GENERAL')),
  igv_rate numeric(5, 4) NOT NULL DEFAULT 0.18,
  cash_low_threshold_cents integer NOT NULL DEFAULT 5000,
  default_credit_limit_cents integer NOT NULL DEFAULT 5000,
  overdue_days integer NOT NULL DEFAULT 30,
  stale_product_days integer NOT NULL DEFAULT 15,
  credit_alert_ratio numeric(4, 3) NOT NULL DEFAULT 0.9,
  yape_plin_enabled boolean NOT NULL DEFAULT false,
  receipt_footer text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER business_settings_updated BEFORE UPDATE ON business_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  username text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('ADMIN', 'VENDEDOR', 'AGENTE')),
  secret_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank text NOT NULL,
  account_type text NOT NULL DEFAULT 'AHORROS',
  account_number text NOT NULL,
  cci char(20),
  holder text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  icon text NOT NULL DEFAULT 'pricetag',
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER categories_updated BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text UNIQUE,
  name text NOT NULL,
  category_id uuid REFERENCES categories (id),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  cost_cents integer CHECK (cost_cents >= 0),
  stock numeric(12, 3) NOT NULL DEFAULT 0,
  min_stock numeric(12, 3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'UND' CHECK (unit IN ('UND', 'KG')),
  tax_affectation text NOT NULL DEFAULT 'GRAVADO'
    CHECK (tax_affectation IN ('GRAVADO', 'EXONERADO', 'INAFECTO')),
  image_url text,
  perufoodnet_class text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_updated_idx ON products (updated_at);
CREATE INDEX products_name_idx ON products (lower(name));
CREATE TRIGGER products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historial de precios: sirve para auditar y para aceptar ventas hechas sin
-- internet con un precio que cambió mientras el teléfono estaba desconectado.
CREATE TABLE price_history (
  id bigserial PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id),
  price_cents integer NOT NULL,
  changed_by uuid REFERENCES users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  photo_url text,
  doc_type text NOT NULL DEFAULT 'NONE' CHECK (doc_type IN ('DNI', 'RUC', 'CE', 'NONE')),
  doc_number text,
  credit_limit_cents integer NOT NULL DEFAULT 5000 CHECK (credit_limit_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_updated_idx ON customers (updated_at);
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Series y correlativos de comprobantes (B001, F001, T001...).
CREATE TABLE doc_series (
  serie text PRIMARY KEY,
  doc_type text NOT NULL CHECK (doc_type IN ('TICKET_POS', 'BOLETA', 'FACTURA')),
  last_number integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by uuid NOT NULL REFERENCES users (id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cents integer NOT NULL CHECK (opening_cents >= 0),
  closed_by uuid REFERENCES users (id),
  closed_at timestamptz,
  expected_cents integer,
  counted_cents integer,
  notes text
);
-- Solo puede haber una caja abierta a la vez.
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions ((true)) WHERE closed_at IS NULL;

CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cash_sessions (id),
  kind text NOT NULL CHECK (kind IN ('IN', 'OUT')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales (
  -- El id lo genera el teléfono: si la venta se reenvía tras un corte de internet, no se duplica.
  id uuid PRIMARY KEY,
  number bigserial UNIQUE,
  seller_id uuid NOT NULL REFERENCES users (id),
  customer_id uuid REFERENCES customers (id),
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
  doc_type text NOT NULL CHECK (doc_type IN ('TICKET', 'TICKET_POS', 'BOLETA', 'FACTURA')),
  serie text,
  correlativo integer,
  sunat_status text NOT NULL DEFAULT 'NO_APLICA'
    CHECK (sunat_status IN ('NO_APLICA', 'PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR')),
  sunat_qr text,
  sunat_hash text,
  sunat_pdf_url text,
  sunat_response jsonb,
  sunat_attempts integer NOT NULL DEFAULT 0,
  subtotal_cents integer NOT NULL,
  discount_cents integer NOT NULL DEFAULT 0,
  gravada_cents integer NOT NULL DEFAULT 0,
  exonerada_cents integer NOT NULL DEFAULT 0,
  inafecta_cents integer NOT NULL DEFAULT 0,
  igv_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL,
  change_cents integer NOT NULL DEFAULT 0,
  buyer_doc_type text,
  buyer_doc_number text,
  buyer_name text,
  buyer_address text,
  discount_authorized_by uuid REFERENCES users (id),
  credit_authorized_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES users (id),
  void_reason text,
  UNIQUE (serie, correlativo)
);
CREATE INDEX sales_created_idx ON sales (created_at);
CREATE INDEX sales_seller_idx ON sales (seller_id, created_at);
CREATE INDEX sales_sunat_pending_idx ON sales (sunat_status) WHERE sunat_status IN ('PENDIENTE', 'ERROR');

CREATE TABLE sale_items (
  id bigserial PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id),
  name text NOT NULL,
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  unit_price_cents integer NOT NULL,
  total_cents integer NOT NULL,
  discount_cents integer NOT NULL DEFAULT 0,
  tax_affectation text NOT NULL,
  igv_cents integer NOT NULL DEFAULT 0
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

-- Cobros por QR interoperable (TAYPI): un mismo QR sirve para Yape y Plin.
CREATE TABLE qr_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_payment_id text,
  reference text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED')),
  qr_payload text NOT NULL,
  qr_image_url text,
  checkout_url text,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  wallet text,
  raw jsonb,
  created_by uuid NOT NULL REFERENCES users (id),
  -- Un cobro pagado solo puede usarse una vez (en una venta o en un abono).
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX qr_charges_provider_idx ON qr_charges (provider, provider_payment_id);
CREATE TRIGGER qr_charges_updated BEFORE UPDATE ON qr_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id bigserial PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD', 'FIADO')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  tendered_cents integer,
  change_cents integer NOT NULL DEFAULT 0,
  confirmation text CHECK (confirmation IN ('QR', 'MANUAL')),
  charge_id uuid UNIQUE REFERENCES qr_charges (id),
  reference text
);
CREATE INDEX payments_sale_idx ON payments (sale_id);

-- El "cuaderno de fiados": cada fiado suma deuda y cada abono la resta.
CREATE TABLE credit_movements (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers (id),
  kind text NOT NULL CHECK (kind IN ('FIADO', 'ABONO')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  sale_id uuid REFERENCES sales (id),
  method text CHECK (method IN ('CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD')),
  confirmation text CHECK (confirmation IN ('QR', 'MANUAL')),
  charge_id uuid UNIQUE REFERENCES qr_charges (id),
  user_id uuid NOT NULL REFERENCES users (id),
  note text,
  created_at timestamptz NOT NULL,
  -- clock_timestamp(): orden real de inserción (la constancia de abono calcula el saldo con él).
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX credit_movements_customer_idx ON credit_movements (customer_id, created_at);

-- Cada movimiento de crédito "toca" al cliente para que los teléfonos bajen su nuevo saldo.
CREATE OR REPLACE FUNCTION touch_customer() RETURNS trigger AS $$
BEGIN
  UPDATE customers SET updated_at = now() WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER credit_movements_touch AFTER INSERT ON credit_movements
  FOR EACH ROW EXECUTE FUNCTION touch_customer();

-- Deuda por cliente. oldest_unpaid_at aplica los abonos a los fiados más
-- antiguos primero (FIFO), como se hace en el cuaderno.
CREATE VIEW customer_debt AS
WITH totals AS (
  SELECT customer_id,
         COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'FIADO'), 0) AS fiado_total,
         COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'ABONO'), 0) AS abono_total,
         MAX(created_at) FILTER (WHERE kind = 'ABONO') AS last_payment_at
  FROM credit_movements
  GROUP BY customer_id
), running AS (
  SELECT customer_id, created_at,
         SUM(amount_cents) OVER (PARTITION BY customer_id ORDER BY created_at, id) AS cumulative
  FROM credit_movements
  WHERE kind = 'FIADO'
)
SELECT c.id AS customer_id,
       COALESCE(t.fiado_total, 0) - COALESCE(t.abono_total, 0) AS balance_cents,
       t.last_payment_at,
       (SELECT MIN(r.created_at) FROM running r
         WHERE r.customer_id = c.id AND r.cumulative > COALESCE(t.abono_total, 0)) AS oldest_unpaid_at
FROM customers c
LEFT JOIN totals t ON t.customer_id = c.id;

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  title text NOT NULL,
  message text NOT NULL,
  target_roles text[] NOT NULL,
  entity_id uuid,
  -- Evita repetir la misma alerta mientras siga abierta.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  pushed_at timestamptz
);
CREATE UNIQUE INDEX alerts_open_dedupe ON alerts (dedupe_key) WHERE resolved_at IS NULL;

CREATE TABLE alert_reads (
  alert_id uuid NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, user_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES users (id),
  title text NOT NULL,
  body text NOT NULL,
  target_roles text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_reads (
  notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users (id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);
