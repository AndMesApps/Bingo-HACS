-- Migración: varios bingos con histórico (Reiniciar Bingo). Idempotente: se puede ejecutar más de una vez.
-- Pégala completa en el editor SQL de Supabase y dale Run. Es segura de correr antes de fusionar el PR.

-- El trigger de control estricto permite liberar tablas solo dentro de la transacción de reinicio.
CREATE OR REPLACE FUNCTION tablas_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.compra_id IS NOT NULL THEN
      RAISE EXCEPTION 'La tabla % ya está vendida y no se puede borrar.', OLD.serial;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.compra_id IS NOT NULL AND COALESCE(current_setting('app.reinicio', true), '') <> '1' AND (
       NEW.compra_id IS DISTINCT FROM OLD.compra_id
       OR NEW.estado <> 'vendida'
       OR NEW.serial <> OLD.serial) THEN
    RAISE EXCEPTION 'La tabla % ya fue asignada a otra compra y no se puede reasignar.', OLD.serial;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------- Varios bingos con histórico ----------
-- Hay un solo Bingo activo; "Reiniciar Bingo" lo cierra (guarda su configuración y su resumen) y abre uno nuevo.
CREATE TABLE IF NOT EXISTS bingos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cerrado')),
  config TEXT,
  resumen TEXT,
  iniciado_en TEXT NOT NULL,
  cerrado_en TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bingo_activo ON bingos (estado) WHERE estado = 'activo';
INSERT INTO bingos (nombre, iniciado_en)
  SELECT (SELECT nombre FROM evento WHERE id = 1), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  WHERE NOT EXISTS (SELECT 1 FROM bingos);

ALTER TABLE compras ADD COLUMN IF NOT EXISTS bingo_id INTEGER REFERENCES bingos(id);
UPDATE compras SET bingo_id = (SELECT id FROM bingos WHERE estado = 'activo') WHERE bingo_id IS NULL;
ALTER TABLE compras ALTER COLUMN bingo_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compras_bingo ON compras(bingo_id);

ALTER TABLE premios ADD COLUMN IF NOT EXISTS bingo_id INTEGER REFERENCES bingos(id);
UPDATE premios SET bingo_id = (SELECT id FROM bingos WHERE estado = 'activo') WHERE bingo_id IS NULL;
ALTER TABLE premios ALTER COLUMN bingo_id SET NOT NULL;
-- Compra ganadora: se guarda al asignar el ganador para que un premio de un Bingo cerrado no apunte a otro comprador.
ALTER TABLE premios ADD COLUMN IF NOT EXISTS compra_id INTEGER REFERENCES compras(id);
UPDATE premios p SET compra_id = t.compra_id FROM tablas t
  WHERE t.serial = p.serial AND p.compra_id IS NULL AND t.compra_id IS NOT NULL
    AND p.bingo_id = (SELECT id FROM bingos WHERE estado = 'activo');

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS bingo_id INTEGER REFERENCES bingos(id);
UPDATE gastos SET bingo_id = (SELECT id FROM bingos WHERE estado = 'activo') WHERE bingo_id IS NULL;
ALTER TABLE gastos ALTER COLUMN bingo_id SET NOT NULL;

-- Si una inserción no indica el Bingo, se usa el activo (así el código anterior sigue funcionando durante la migración).
CREATE OR REPLACE FUNCTION bingo_por_defecto() RETURNS trigger AS $$
BEGIN
  IF NEW.bingo_id IS NULL THEN
    NEW.bingo_id := (SELECT id FROM bingos WHERE estado = 'activo');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS compras_bingo_trg ON compras;
CREATE TRIGGER compras_bingo_trg BEFORE INSERT ON compras FOR EACH ROW EXECUTE FUNCTION bingo_por_defecto();
DROP TRIGGER IF EXISTS premios_bingo_trg ON premios;
CREATE TRIGGER premios_bingo_trg BEFORE INSERT ON premios FOR EACH ROW EXECUTE FUNCTION bingo_por_defecto();
DROP TRIGGER IF EXISTS gastos_bingo_trg ON gastos;
CREATE TRIGGER gastos_bingo_trg BEFORE INSERT ON gastos FOR EACH ROW EXECUTE FUNCTION bingo_por_defecto();

-- Qué tablas vendió cada Bingo cerrado (las tablas vuelven a quedar disponibles para el siguiente).
CREATE TABLE IF NOT EXISTS tablas_historial (
  bingo_id INTEGER NOT NULL REFERENCES bingos(id),
  serial TEXT NOT NULL,
  compra_id INTEGER NOT NULL REFERENCES compras(id),
  vendida_en TEXT,
  PRIMARY KEY (bingo_id, serial)
);
CREATE INDEX IF NOT EXISTS idx_tablas_historial_compra ON tablas_historial(compra_id);
ALTER TABLE bingos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tablas_historial ENABLE ROW LEVEL SECURITY;
