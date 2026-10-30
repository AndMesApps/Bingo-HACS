CREATE TABLE IF NOT EXISTS evento (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre TEXT NOT NULL DEFAULT 'Bingo',
  precio_tabla NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda TEXT NOT NULL DEFAULT '',
  fecha_sorteo TEXT NOT NULL DEFAULT '',
  cuentas_pago TEXT NOT NULL DEFAULT '',
  exigir_pago_completo BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO evento (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS compras (
  id SERIAL PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  cedula TEXT NOT NULL,
  telefono TEXT NOT NULL,
  correo TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 50),
  precio_unitario NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('por_verificar','verificada','enviada','rechazada')),
  whatsapp_estado TEXT NOT NULL DEFAULT 'no_enviado'
    CHECK (whatsapp_estado IN ('no_enviado','enviado','fallido','manual')),
  whatsapp_error TEXT,
  creada_en TEXT NOT NULL,
  verificada_en TEXT,
  enviada_en TEXT
);

CREATE TABLE IF NOT EXISTS pagos (
  id SERIAL PRIMARY KEY,
  compra_id INTEGER NOT NULL REFERENCES compras(id),
  monto_reportado NUMERIC(12,2) NOT NULL,
  monto_verificado NUMERIC(12,2),
  metodo TEXT NOT NULL,
  referencia TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('por_verificar','verificado','rechazado')),
  creado_en TEXT NOT NULL,
  verificado_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_pagos_compra ON pagos(compra_id);

CREATE TABLE IF NOT EXISTS comprobantes (
  id SERIAL PRIMARY KEY,
  pago_id INTEGER NOT NULL REFERENCES pagos(id),
  ruta TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comprobantes_pago ON comprobantes(pago_id);

-- La clave primaria impide seriales repetidos. La venta toma tablas con FOR UPDATE SKIP LOCKED.
CREATE TABLE IF NOT EXISTS tablas (
  serial TEXT PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible','vendida')),
  compra_id INTEGER REFERENCES compras(id),
  vendida_en TEXT,
  creada_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tablas_estado ON tablas(estado);
CREATE INDEX IF NOT EXISTS idx_tablas_compra ON tablas(compra_id);

CREATE TABLE IF NOT EXISTS premios (
  id SERIAL PRIMARY KEY,
  ronda TEXT NOT NULL,
  premio TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  serial TEXT REFERENCES tablas(serial),
  pagado BOOLEAN NOT NULL DEFAULT false,
  pagado_en TEXT,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gastos (
  id SERIAL PRIMARY KEY,
  fecha TEXT NOT NULL,
  concepto TEXT NOT NULL,
  categoria TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bitacora (
  id SERIAL PRIMARY KEY,
  fecha TEXT NOT NULL,
  accion TEXT NOT NULL,
  detalle TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_intentos (
  ip TEXT NOT NULL,
  fecha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_intentos(ip, fecha);

-- ---------- v3: formulario real, aprobación de tablas y entrega por canales ----------
-- Idempotente: se puede ejecutar sobre una base ya creada con la versión anterior.
ALTER TABLE compras ADD COLUMN IF NOT EXISTS ciudad TEXT NOT NULL DEFAULT '';
ALTER TABLE compras ADD COLUMN IF NOT EXISTS referido_por TEXT NOT NULL DEFAULT '';
-- cantidad = tablas que pidió el comprador; tablas_aprobadas = las que definió quien verificó el pago.
ALTER TABLE compras ADD COLUMN IF NOT EXISTS tablas_aprobadas INTEGER CHECK (tablas_aprobadas >= 1);
-- Enlace privado con el que el comprador ve sus tablas (128 bits aleatorios).
ALTER TABLE compras ADD COLUMN IF NOT EXISTS token_entrega TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_compras_token ON compras(token_entrega) WHERE token_entrega IS NOT NULL;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS correo_estado TEXT NOT NULL DEFAULT 'no_enviado'
  CHECK (correo_estado IN ('no_enviado','enviado','fallido','manual'));
ALTER TABLE compras ADD COLUMN IF NOT EXISTS correo_error TEXT;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS fisica_estado TEXT NOT NULL DEFAULT 'no'
  CHECK (fisica_estado IN ('no','pendiente','entregada'));
ALTER TABLE compras ADD COLUMN IF NOT EXISTS fisica_nota TEXT;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS fisica_en TEXT;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS fecha_pago TEXT NOT NULL DEFAULT '';
-- Sobrante: lo pagado por encima de las tablas entregadas. El comprador elige donarlo o que se lo devuelvan
-- (con una nota de cómo); la administración lo controla hasta que queda donado o devuelto.
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_destino TEXT NOT NULL DEFAULT ''
  CHECK (sobrante_destino IN ('','donacion','devolucion'));
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_nota TEXT NOT NULL DEFAULT '';
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_monto NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_estado TEXT NOT NULL DEFAULT 'ninguno'
  CHECK (sobrante_estado IN ('ninguno','por_definir','donado','por_devolver','devuelto'));
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_resolucion TEXT;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS sobrante_en TEXT;
ALTER TABLE evento ALTER COLUMN exigir_pago_completo SET DEFAULT true;
-- Datos de pago configurables desde el panel: cuenta, llave (para transferencias entre bancos) y QR del banco.
ALTER TABLE evento ADD COLUMN IF NOT EXISTS banco TEXT NOT NULL DEFAULT '';
ALTER TABLE evento ADD COLUMN IF NOT EXISTS tipo_cuenta TEXT NOT NULL DEFAULT '' CHECK (tipo_cuenta IN ('','Ahorros','Corriente'));
ALTER TABLE evento ADD COLUMN IF NOT EXISTS numero_cuenta TEXT NOT NULL DEFAULT '';
ALTER TABLE evento ADD COLUMN IF NOT EXISTS titular_cuenta TEXT NOT NULL DEFAULT '';
ALTER TABLE evento ADD COLUMN IF NOT EXISTS llave_pago TEXT NOT NULL DEFAULT '';
ALTER TABLE evento ADD COLUMN IF NOT EXISTS qr_pago TEXT NOT NULL DEFAULT '';

-- ---------- Control estricto de tablas ----------
-- Una tabla vendida siempre tiene compra, y una disponible nunca la tiene.
ALTER TABLE tablas DROP CONSTRAINT IF EXISTS tablas_estado_compra_coherente;
ALTER TABLE tablas ADD CONSTRAINT tablas_estado_compra_coherente
  CHECK ((estado = 'vendida') = (compra_id IS NOT NULL));

-- Aunque falle el código de la aplicación, la base rechaza reasignar, liberar o borrar una tabla vendida.
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
DROP TRIGGER IF EXISTS tablas_proteger_trg ON tablas;
CREATE TRIGGER tablas_proteger_trg BEFORE UPDATE OR DELETE ON tablas
  FOR EACH ROW EXECUTE FUNCTION tablas_proteger();

-- ---------- Seguridad ----------
-- La aplicación se conecta como propietario (omite RLS). Sin políticas, la API pública de Supabase
-- (clave anon) no puede leer ni escribir nada: protege cédulas, teléfonos y correos de los compradores.
ALTER TABLE evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tablas ENABLE ROW LEVEL SECURITY;
ALTER TABLE premios ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_intentos ENABLE ROW LEVEL SECURITY;

-- ---------- Donaciones menores al valor de una tabla ----------
-- Quien paga menos que una tabla puede donarlo: la compra queda con cantidad 0 y, al verificar el pago, en estado 'donacion'.
ALTER TABLE compras DROP CONSTRAINT IF EXISTS compras_cantidad_check;
ALTER TABLE compras ADD CONSTRAINT compras_cantidad_check CHECK (cantidad BETWEEN 0 AND 50);
ALTER TABLE compras DROP CONSTRAINT IF EXISTS compras_estado_check;
ALTER TABLE compras ADD CONSTRAINT compras_estado_check
  CHECK (estado IN ('por_verificar','verificada','enviada','rechazada','donacion'));

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

-- ---------- Pieza de invitación (imagen) de cada Bingo ----------
-- NULL = la pieza predeterminada de la app; '' = sin imagen; si no, la imagen propia del Bingo como data URL.
ALTER TABLE evento ADD COLUMN IF NOT EXISTS pieza_invitacion TEXT;
-- Texto que acompaña al enlace y a la imagen al compartir la invitación ('' = el texto predeterminado).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS texto_invitacion TEXT NOT NULL DEFAULT '';

-- ---------- Sorteo en vivo ----------
-- Números de cada tabla (25 enteros por filas en JSON; 0 = casilla libre). Se cargan con scripts/migracion-sorteo.sql.
ALTER TABLE tablas ADD COLUMN IF NOT EXISTS numeros TEXT;
-- Figura que gana cada ronda, su estado de juego y el control de entrega del premio.
ALTER TABLE premios ADD COLUMN IF NOT EXISTS figura TEXT NOT NULL DEFAULT 'carton_lleno';
ALTER TABLE premios ADD COLUMN IF NOT EXISTS ronda_estado TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE premios ADD COLUMN IF NOT EXISTS recibido_por TEXT NOT NULL DEFAULT '';
ALTER TABLE premios ADD COLUMN IF NOT EXISTS entrega_nota TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS balotas (
  id SERIAL PRIMARY KEY,
  premio_id INTEGER NOT NULL REFERENCES premios(id),
  numero INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 75),
  cantada_en TEXT NOT NULL,
  UNIQUE (premio_id, numero)
);
ALTER TABLE balotas ENABLE ROW LEVEL SECURITY;
-- Solo una ronda puede estar en juego a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS premios_una_en_juego ON premios ((true)) WHERE ronda_estado = 'en_juego';
-- ---------- Envío automático de tablas ----------
-- Si está activo, al quedar verificado el pago se envían solas las tablas por WhatsApp y correo (si el comprador dejó correo).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS envio_automatico BOOLEAN NOT NULL DEFAULT false;

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

-- Enlace de la reunión virtual (Zoom, Meet…) que va en el mensaje con las tablas.
ALTER TABLE evento ADD COLUMN IF NOT EXISTS enlace_conexion TEXT NOT NULL DEFAULT '';
