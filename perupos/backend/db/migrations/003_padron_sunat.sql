-- Copia local del Padrón Reducido del RUC que SUNAT publica como datos abiertos.
-- Se carga con: npm run padron:import -w @perupos/backend -- --file padron_reducido_ruc.txt
CREATE TABLE sunat_padron (
  ruc char(11) PRIMARY KEY,
  razon_social text NOT NULL,
  estado text NOT NULL,
  condicion text NOT NULL,
  ubigeo text,
  loaded_at timestamptz NOT NULL DEFAULT now()
);
