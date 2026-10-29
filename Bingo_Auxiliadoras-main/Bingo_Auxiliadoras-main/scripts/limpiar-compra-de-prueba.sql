-- Deshace UNA compra de prueba: libera sus tablas y borra la compra con sus pagos y comprobantes.
--
-- USO (Supabase -> SQL Editor):
--   1. Cambia 'BNG-XXXXXX' por el código de la compra de prueba (aparece en el panel y en el formulario).
--   2. Revisa el resultado del primer SELECT: debe ser la compra de prueba y solo esa.
--   3. Ejecuta todo el script.
--
-- El control estricto de tablas (trigger tablas_proteger_trg) impide liberar una tabla vendida; por eso se
-- desactiva un instante, dentro de la misma transacción, y se vuelve a activar antes de terminar.
-- Si algo falla, no se aplica nada. La bitácora conserva el rastro de lo que se hizo.
-- NO lo uses con compras reales: devolvería tablas ya entregadas a otra persona.

BEGIN;

-- 1) Qué se va a deshacer (solo lectura).
SELECT c.codigo, c.nombre, c.estado, c.cantidad,
       (SELECT array_agg(t.serial ORDER BY t.serial) FROM tablas t WHERE t.compra_id = c.id) AS tablas
FROM compras c WHERE c.codigo = 'BNG-XXXXXX';

-- 2) Liberar las tablas (el trigger se desactiva solo dentro de esta transacción).
ALTER TABLE tablas DISABLE TRIGGER tablas_proteger_trg;
UPDATE tablas SET estado = 'disponible', compra_id = NULL, vendida_en = NULL
WHERE compra_id = (SELECT id FROM compras WHERE codigo = 'BNG-XXXXXX');
ALTER TABLE tablas ENABLE TRIGGER tablas_proteger_trg;

-- 3) Borrar comprobantes, pagos y la compra.
DELETE FROM comprobantes WHERE pago_id IN (
  SELECT p.id FROM pagos p JOIN compras c ON c.id = p.compra_id WHERE c.codigo = 'BNG-XXXXXX');
DELETE FROM pagos WHERE compra_id = (SELECT id FROM compras WHERE codigo = 'BNG-XXXXXX');
DELETE FROM compras WHERE codigo = 'BNG-XXXXXX';

-- 4) Dejar constancia.
INSERT INTO bitacora (fecha, accion, detalle)
VALUES (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'compra de prueba eliminada', 'BNG-XXXXXX');

-- 5) Comprobación: el trigger debe seguir activo (tgenabled = O).
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'tablas_proteger_trg';

COMMIT;
