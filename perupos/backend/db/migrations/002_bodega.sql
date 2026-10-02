-- Ajustes para el uso real en bodegas peruanas.

-- Trato del cliente ("Don Juan", "Doña Rosa") y marca del tendero ("siempre paga" / "le cuesta pagar").
ALTER TABLE customers
  ADD COLUMN trato text CHECK (trato IN ('DON', 'DONA')),
  ADD COLUMN reputation text CHECK (reputation IN ('CUMPLIDO', 'MOROSO'));

-- Lo que el vendedor le yapeó al administrador al cerrar para cuadrar la caja.
ALTER TABLE cash_sessions ADD COLUMN transferred_cents integer NOT NULL DEFAULT 0 CHECK (transferred_cents >= 0);

-- N° de operación de un Yape/Plin confirmado a mano (sin QR).
ALTER TABLE credit_movements ADD COLUMN reference text;

-- Un mismo N° de operación de Yape/Plin no puede usarse dos veces, ni en dos ventas,
-- ni en dos abonos, ni en una venta y un abono (de este o de otro cliente).
CREATE TABLE operation_refs (
  method text NOT NULL CHECK (method IN ('YAPE', 'PLIN')),
  reference text NOT NULL,
  sale_id uuid REFERENCES sales (id),
  movement_id uuid REFERENCES credit_movements (id),
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (method, reference)
);
