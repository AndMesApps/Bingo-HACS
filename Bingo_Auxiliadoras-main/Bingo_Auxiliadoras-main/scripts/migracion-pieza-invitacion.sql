-- Migración: pieza de invitación por Bingo. Idempotente. Pégala en el editor SQL de Supabase y dale Run.
-- ---------- Pieza de invitación (imagen) de cada Bingo ----------
-- NULL = la pieza predeterminada de la app; '' = sin imagen; si no, la imagen propia del Bingo como data URL.
ALTER TABLE evento ADD COLUMN IF NOT EXISTS pieza_invitacion TEXT;
-- Texto que acompaña al enlace y a la imagen al compartir la invitación ('' = el texto predeterminado).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS texto_invitacion TEXT NOT NULL DEFAULT '';
