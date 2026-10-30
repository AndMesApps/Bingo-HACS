-- Empates (varias ganadoras por premio) y garantía de que no existan dos tablas con los mismos números.
-- Idempotente: se puede correr más de una vez. Ejecutar completo en el editor SQL de Supabase.
-- Antes hay que haber corrido migracion-sorteo.sql (columna de números de cada tabla).

-- ---------- Empates: varias tablas ganadoras por premio ----------
-- Cada tabla ganadora lleva su parte del premio y su propia entrega (quién la recibió y cuándo).
CREATE TABLE IF NOT EXISTS premio_ganadores (
  id SERIAL PRIMARY KEY,
  premio_id INTEGER NOT NULL REFERENCES premios(id),
  serial TEXT NOT NULL REFERENCES tablas(serial),
  compra_id INTEGER NOT NULL REFERENCES compras(id),
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  entregado BOOLEAN NOT NULL DEFAULT false,
  entregado_en TEXT,
  recibido_por TEXT NOT NULL DEFAULT '',
  entrega_nota TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL,
  UNIQUE (premio_id, serial)
);
CREATE INDEX IF NOT EXISTS idx_premio_ganadores_premio ON premio_ganadores(premio_id);
ALTER TABLE premio_ganadores ENABLE ROW LEVEL SECURITY;
-- Premios que ya tenían una sola ganadora (esquema anterior) pasan a la tabla nueva.
INSERT INTO premio_ganadores (premio_id, serial, compra_id, monto, entregado, entregado_en, recibido_por, entrega_nota, creado_en)
  SELECT p.id, p.serial, p.compra_id, p.monto, p.pagado, p.pagado_en, COALESCE(p.recibido_por, ''), COALESCE(p.entrega_nota, ''), p.creado_en
  FROM premios p
  WHERE p.serial IS NOT NULL AND p.compra_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM premio_ganadores g WHERE g.premio_id = p.id);
UPDATE premios SET ronda_estado = 'cerrada'
  WHERE serial IS NOT NULL AND ronda_estado = 'pendiente' AND EXISTS (SELECT 1 FROM premio_ganadores g WHERE g.premio_id = premios.id);

-- ---------- Garantía: nunca dos tablas con los mismos números ----------
-- numeros_clave = los 25 números ordenados. Un índice único sobre ella impide, desde la base de datos, tanto dos tablas
-- con la misma distribución como dos tablas con los mismos números en otra disposición. También exige 25 números de 0 a 75.
ALTER TABLE tablas ADD COLUMN IF NOT EXISTS numeros_clave TEXT;
CREATE OR REPLACE FUNCTION tablas_numeros_clave_fn() RETURNS trigger AS $fn$
BEGIN
  IF NEW.numeros IS NULL THEN
    NEW.numeros_clave := NULL;
    RETURN NEW;
  END IF;
  IF jsonb_array_length(NEW.numeros::jsonb) <> 25 THEN
    RAISE EXCEPTION 'Una tabla debe tener exactamente 25 números (la tabla % tiene %).', NEW.serial, jsonb_array_length(NEW.numeros::jsonb);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.numeros::jsonb) AS e WHERE e::int < 0 OR e::int > 75) THEN
    RAISE EXCEPTION 'Los números de la tabla % deben estar entre 0 y 75.', NEW.serial;
  END IF;
  NEW.numeros_clave := (SELECT string_agg(e, ',' ORDER BY e::int) FROM jsonb_array_elements_text(NEW.numeros::jsonb) AS e);
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tablas_numeros_clave_trg ON tablas;
CREATE TRIGGER tablas_numeros_clave_trg BEFORE INSERT OR UPDATE OF numeros ON tablas
  FOR EACH ROW EXECUTE FUNCTION tablas_numeros_clave_fn();
UPDATE tablas SET numeros_clave = (SELECT string_agg(e, ',' ORDER BY e::int) FROM jsonb_array_elements_text(tablas.numeros::jsonb) AS e)
  WHERE numeros IS NOT NULL AND numeros_clave IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tablas_numeros_clave_uq ON tablas (numeros_clave) WHERE numeros_clave IS NOT NULL;
