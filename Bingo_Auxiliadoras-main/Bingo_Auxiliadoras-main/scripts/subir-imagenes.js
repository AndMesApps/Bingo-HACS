// Sube las imágenes de las tablas (1.jpg, 2.jpg, ...) a un bucket PRIVADO de Supabase Storage.
// Uso: npm run subir-imagenes -- "C:\ruta\TABLAS BINGO JPG"
// Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (clave secreta: nunca va al navegador ni al repositorio).
const fs = require('node:fs');
const path = require('node:path');

const BUCKET = process.env.SUPABASE_BUCKET || 'tablas';
const CONCURRENCIA = 5;

async function main() {
  const carpeta = process.argv[2];
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!carpeta) throw new Error('Uso: npm run subir-imagenes -- "ruta\\a\\la\\carpeta"');
  if (!url || !clave) throw new Error('Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY antes de subir.');

  const archivos = fs.readdirSync(carpeta).filter(f => /^[A-Za-z0-9._-]+\.jpg$/i.test(f)).sort();
  if (!archivos.length) throw new Error('No hay archivos .jpg en esa carpeta.');

  const headers = { apikey: clave };
  if (clave.startsWith('eyJ')) headers.Authorization = `Bearer ${clave}`;

  // Bucket privado: sin URL pública. Si ya existe, Supabase responde 400 y se continúa.
  const crear = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, allowed_mime_types: ['image/jpeg'] }),
  });
  console.log(crear.ok ? `Bucket "${BUCKET}" creado (privado).` : `Bucket "${BUCKET}": ${(await crear.text()).slice(0, 120)}`);

  let subidas = 0;
  const fallidas = [];
  const cola = [...archivos];
  async function trabajador() {
    while (cola.length) {
      const nombre = cola.shift();
      const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(nombre.toLowerCase())}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: fs.readFileSync(path.join(carpeta, nombre)),
      });
      if (res.ok) subidas++;
      else fallidas.push(`${nombre}: ${(await res.text()).slice(0, 100)}`);
      if ((subidas + fallidas.length) % 50 === 0) console.log(`${subidas + fallidas.length} de ${archivos.length}…`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));
  console.log(`Subidas: ${subidas} de ${archivos.length}.`);
  if (fallidas.length) {
    console.error('Fallaron:\n' + fallidas.join('\n'));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
