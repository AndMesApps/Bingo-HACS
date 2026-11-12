-- Sobrante dividido: una parte se dona y el resto se devuelve (idempotente; también está en src/esquema.sql).
-- Correr en Supabase > SQL Editor ANTES de desplegar la nueva versión.

-- Parte del sobrante que se dona. El resto (sobrante_monto - sobrante_donar) es lo que se devuelve.
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_donar NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Los sobrantes que ya estaban donados completos quedan con toda su parte como donación.
UPDATE compras SET sobrante_donar = sobrante_monto WHERE sobrante_estado = 'donado' AND sobrante_donar = 0;
