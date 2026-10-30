const { desdePool } = require('./db');
const { crearServicios } = require('./servicios');
const { crearWhatsApp } = require('./whatsapp');
const { crearStorage } = require('./storage');
const { crearCorreo } = require('./correo');
const { crearImagenes } = require('./imagenes');

// Vercel reutiliza la instancia entre peticiones cercanas: se crea una sola vez por función.
let ctx;

function obtenerContexto(env = process.env) {
  if (ctx) return ctx;
  if (!env.DATABASE_URL) throw new Error('Falta DATABASE_URL en las variables de entorno.');
  const db = desdePool(env.DATABASE_URL);
  const whatsapp = crearWhatsApp({
    token: env.WHATSAPP_TOKEN,
    phoneId: env.WHATSAPP_PHONE_ID,
    plantilla: env.WHATSAPP_PLANTILLA,
    idioma: env.WHATSAPP_IDIOMA || 'es',
    codigoPais: env.CODIGO_PAIS || '57',
  });
  const correo = crearCorreo({ apiKey: env.RESEND_API_KEY, desde: env.EMAIL_FROM });
  const imagenes = crearImagenes({ url: env.SUPABASE_URL, clave: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_BUCKET || 'tablas' });
  const storage = crearStorage();
  const servicios = crearServicios({ db, whatsapp, correo });
  ctx = { db, whatsapp, correo, imagenes, storage, servicios, env };
  return ctx;
}

module.exports = { obtenerContexto };
