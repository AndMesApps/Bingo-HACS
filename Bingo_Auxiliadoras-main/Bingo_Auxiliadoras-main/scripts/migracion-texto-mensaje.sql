-- Texto editable del mensaje que reciben los benefactores con sus tablas (idempotente; '' = texto original).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS texto_mensaje TEXT NOT NULL DEFAULT '';
