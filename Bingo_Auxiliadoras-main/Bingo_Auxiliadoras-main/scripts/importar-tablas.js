// Importa tus tablas existentes desde un archivo de texto (un serial por línea o separados por coma),
// o un rango numérico: npm run importar-tablas -- 1-400
// Uso: npm run importar-tablas -- ruta/al/archivo.txt   (requiere DATABASE_URL)
const fs = require('node:fs');
const { desdePool } = require('../src/db');
const { crearServicios } = require('../src/servicios');
const { crearWhatsApp } = require('../src/whatsapp');

async function main() {
  const archivo = process.argv[2];
  if (!archivo) throw new Error('Uso: npm run importar-tablas -- ruta/al/archivo.txt');
  if (!process.env.DATABASE_URL) throw new Error('Define DATABASE_URL antes de importar.');
  const db = desdePool(process.env.DATABASE_URL);
  try {
    const servicios = crearServicios({ db, whatsapp: crearWhatsApp({}) });
    const rango = archivo.match(/^(\d+)-(\d+)$/);
    let entrada;
    if (rango) {
      const [desde, hasta] = [Number(rango[1]), Number(rango[2])];
      if (hasta < desde || hasta - desde > 5000) throw new Error('Rango no válido.');
      entrada = Array.from({ length: hasta - desde + 1 }, (_, i) => String(desde + i)).join('\n');
    } else {
      entrada = fs.readFileSync(archivo, 'utf8');
    }
    const r = await servicios.importarTablas(entrada);
    console.log(`Leídas: ${r.leidas} · Nuevas: ${r.insertadas} · Repetidas: ${r.repetidas}`);
    console.log(`Total disponibles: ${await servicios.tablasDisponibles()}`);
  } finally {
    await db.cerrar();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
