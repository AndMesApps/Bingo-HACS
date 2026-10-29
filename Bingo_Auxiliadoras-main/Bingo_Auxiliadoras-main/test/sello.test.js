const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { sellarTabla, formatearTelefono } = require('../src/sello');

async function jpgBase(ancho = 500, alto = 710) {
  const c = createCanvas(ancho, alto);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#faf6ee';
  ctx.fillRect(0, 0, ancho, alto);
  return c.encode('jpeg', 90);
}

test('el teléfono se muestra legible', () => {
  assert.equal(formatearTelefono('573001234567'), '+57 300 123 4567');
  assert.equal(formatearTelefono('584121234567'), '+58 412 123 4567');
  assert.equal(formatearTelefono('3001234567'), '300 123 4567');
  assert.equal(formatearTelefono(''), '');
});

test('la tabla sellada es un JPG más alto que el original (banda con los datos del comprador)', async () => {
  const base = await jpgBase();
  const sellada = await sellarTabla({ buffer: base, serial: '37', nombre: 'Dora María Gómez', telefono: '573001234567', codigo: 'BNG-4K7P2X' });
  assert.equal(sellada[0], 0xff);
  assert.equal(sellada[1], 0xd8, 'es un JPEG');
  const [a, b] = await Promise.all([loadImage(base), loadImage(sellada)]);
  assert.equal(b.width, a.width);
  assert.ok(b.height > a.height, 'se añadió la banda inferior');
  assert.notDeepEqual(Buffer.from(sellada), Buffer.from(base));
});

test('el sello cambia con el comprador: dos nombres dan imágenes distintas', async () => {
  const base = await jpgBase();
  const a = await sellarTabla({ buffer: base, serial: '1', nombre: 'Ana Pérez', telefono: '573001111111', codigo: 'BNG-AAAAAA' });
  const b = await sellarTabla({ buffer: base, serial: '1', nombre: 'Luis Gómez', telefono: '573002222222', codigo: 'BNG-BBBBBB' });
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
});

test('un nombre larguísimo se ajusta sin romper el sello', async () => {
  const base = await jpgBase();
  const largo = 'María de los Ángeles Fernanda del Carmen Rodríguez de la Santísima Trinidad Gómez Ñáñez'.repeat(2);
  const sellada = await sellarTabla({ buffer: base, serial: '400', nombre: largo, telefono: '573001234567', codigo: 'BNG-ZZZZZZ' });
  assert.ok(sellada.length > 1000);
});

test('sin nombre del comprador no se sella (no se entrega la tabla sin identificar)', async () => {
  const base = await jpgBase();
  await assert.rejects(sellarTabla({ buffer: base, serial: '1', nombre: '  ', telefono: '573001234567', codigo: 'X' }), /nombre/);
});


test('PDF: 4 tablas por hoja carta; 9 tablas dan 3 hojas', async () => {
  const { PDFDocument } = require('pdf-lib');
  const { armarPdf } = require('../src/pdf');
  const base = await jpgBase();
  const sellada = await sellarTabla({ buffer: base, serial: '1', nombre: 'Ana Pérez', telefono: '573001234567', codigo: 'BNG-AAAAAA', escala: 0.8, calidad: 80 });
  const pdf = await armarPdf(Array.from({ length: 9 }, () => sellada), { titulo: 'Prueba' });
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 3);
  const { width, height } = doc.getPage(0).getSize();
  assert.deepEqual([width, height], [612, 792], 'tamaño carta');
  await assert.rejects(armarPdf([]), /No hay tablas/);
});