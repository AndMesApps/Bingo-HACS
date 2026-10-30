-- Enlace de la reunión virtual del bingo, que se incluye en el mensaje con las tablas (idempotente).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS enlace_conexion TEXT NOT NULL DEFAULT '';
