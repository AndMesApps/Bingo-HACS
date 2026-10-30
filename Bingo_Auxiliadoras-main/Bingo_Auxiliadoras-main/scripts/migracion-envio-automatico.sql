-- Envío automático de tablas al verificar el pago (idempotente; también está en src/esquema.sql).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS envio_automatico BOOLEAN NOT NULL DEFAULT false;
