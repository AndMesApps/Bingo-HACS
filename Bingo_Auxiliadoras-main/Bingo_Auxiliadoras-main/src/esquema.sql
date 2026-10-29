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
ALTER TABLE evento ALTER COLUMN exigir_pago_completo SET DEFAULT true;

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
  IF OLD.compra_id IS NOT NULL AND (
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
