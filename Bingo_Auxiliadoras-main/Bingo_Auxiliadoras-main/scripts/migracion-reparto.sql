-- Reparto de las tablas de una compra entre varias personas (idempotente; también está en src/esquema.sql).
-- Correr en Supabase > SQL Editor ANTES de desplegar la nueva versión.

-- Reparto que el comprador pidió en el formulario (JSON: [{nombre, telefono, cantidad}]; '' = sin reparto).
ALTER TABLE compras ADD COLUMN IF NOT EXISTS reparto TEXT NOT NULL DEFAULT '';

-- Cada persona que recibe tablas de una compra repartida, con su propio enlace y su propio envío por WhatsApp.
CREATE TABLE IF NOT EXISTS entregas (
  id SERIAL PRIMARY KEY,
  compra_id INTEGER NOT NULL REFERENCES compras(id),
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad >= 1),
  token_entrega TEXT UNIQUE,
  whatsapp_estado TEXT NOT NULL DEFAULT 'no_enviado' CHECK (whatsapp_estado IN ('no_enviado','enviado','fallido','manual')),
  whatsapp_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_entregas_compra ON entregas(compra_id);
ALTER TABLE entregas ENABLE ROW LEVEL SECURITY;

ALTER TABLE tablas ADD COLUMN IF NOT EXISTS entrega_id INTEGER REFERENCES entregas(id);
ALTER TABLE tablas_historial ADD COLUMN IF NOT EXISTS entrega_id INTEGER REFERENCES entregas(id);
