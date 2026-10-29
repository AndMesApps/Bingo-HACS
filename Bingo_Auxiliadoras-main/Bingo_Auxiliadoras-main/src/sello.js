// Sella cada tabla con los datos de quien la compró. El sello va grabado en los píxeles de la imagen:
// una banda inferior con nombre, teléfono y código de compra, y una marca de agua diagonal repetida sobre
// toda la tabla. Si la reenvían o le toman una captura, siempre dice para quién es válida.
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { indicativoDe } = require('./paises');

const FUENTES = path.join(__dirname, '..', 'assets', 'fuente');
let fuentesListas = false;
function registrarFuentes() {
  if (fuentesListas) return;
  GlobalFonts.registerFromPath(path.join(FUENTES, 'DejaVuSans.ttf'), 'SelloSans');
  GlobalFonts.registerFromPath(path.join(FUENTES, 'DejaVuSans-Bold.ttf'), 'SelloSansBold');
  fuentesListas = true;
}

const AZUL_OSCURO = '#0f3448';
const AZUL = '#1f7a8c';
const DORADO = '#c9a24b';

// 573001234567 -> +57 300 123 4567; 593991234567 -> +593 99 123 4567. Se separa el indicativo del país
// (el más largo conocido) y el resto se agrupa de derecha a izquierda: 4, 3 y lo que quede.
function formatearTelefono(telefono) {
  const d = String(telefono ?? '').replace(/\D/g, '');
  if (!d) return '';
  const cc = indicativoDe(d);
  const resto = cc ? d.slice(cc.length) : d;
  if (cc === '34' && resto.length === 9) return `+34 ${resto.slice(0, 3)} ${resto.slice(3, 6)} ${resto.slice(6)}`; // España: 3-3-3
  const grupos = [];
  let fin = resto.length;
  for (const largo of [4, 3]) {
    if (fin - largo >= 2) { grupos.unshift(resto.slice(fin - largo, fin)); fin -= largo; }
  }
  grupos.unshift(resto.slice(0, fin));
  const local = grupos.join(' ');
  return cc ? `+${cc} ${local}` : local;
}

// Reduce el tamaño de la letra hasta que el texto cabe; si aun así no cabe, lo recorta con puntos suspensivos.
function ajustarTexto(ctx, texto, fuente, tamanoMax, tamanoMin, anchoMax) {
  let tamano = tamanoMax;
  ctx.font = `${tamano}px ${fuente}`;
  while (ctx.measureText(texto).width > anchoMax && tamano > tamanoMin) {
    tamano -= 2;
    ctx.font = `${tamano}px ${fuente}`;
  }
  let t = texto;
  while (ctx.measureText(t).width > anchoMax && t.length > 4) t = t.slice(0, -2);
  return t === texto ? t : t.trimEnd() + '…';
}

// buffer: JPG original de la tabla. Devuelve un JPG nuevo, con la banda de sello añadida debajo.
// escala < 1 reduce el tamaño (se usa en el PDF para que pese menos); calidad es la del JPEG (1 a 100).
async function sellarTabla({ buffer, serial, nombre, telefono, codigo, escala = 1, calidad = 90 }) {
  registrarFuentes();
  const nom = String(nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const tel = formatearTelefono(telefono);
  if (!nom) throw new Error('No se puede sellar una tabla sin el nombre del comprador.');

  const img = await loadImage(buffer);
  const W = img.width;
  const alto = img.height;
  const banda = Math.round(W * 0.17);
  const canvas = createCanvas(Math.round(W * escala), Math.round((alto + banda) * escala));
  const ctx = canvas.getContext('2d');
  ctx.scale(escala, escala);

  ctx.drawImage(img, 0, 0);

  // Marca de agua diagonal, tenue para que los números sigan legibles, repetida por toda la tabla.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, alto);
  ctx.clip();
  ctx.translate(W / 2, alto / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.globalAlpha = 0.17;
  ctx.fillStyle = AZUL;
  ctx.textBaseline = 'middle';
  const tamanoMarca = Math.round(W * 0.032);
  ctx.font = `${tamanoMarca}px SelloSansBold`;
  const marca = [nom, tel].filter(Boolean).join('  ·  ');
  const ancho = ctx.measureText(marca).width;
  const paso = Math.round(W * 0.115);
  const diagonal = Math.hypot(W, alto);
  let fila = 0;
  for (let y = -diagonal / 2; y < diagonal / 2; y += paso, fila++) {
    const desfase = (fila % 2) * (ancho / 2);
    for (let x = -diagonal / 2 - desfase; x < diagonal / 2; x += ancho + W * 0.08) ctx.fillText(marca, x, y);
  }
  ctx.restore();

  // Banda inferior con la identificación del comprador.
  ctx.fillStyle = AZUL_OSCURO;
  ctx.fillRect(0, alto, W, banda);
  ctx.fillStyle = DORADO;
  ctx.fillRect(0, alto, W, 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const cx = W / 2;
  const margen = W * 0.06;

  ctx.fillStyle = '#cfe3ea';
  ctx.font = `${Math.round(W * 0.023)}px SelloSans`;
  ctx.fillText(`TABLA N° ${serial}  ·  VÁLIDA ÚNICAMENTE PARA`, cx, alto + banda * 0.25);

  ctx.fillStyle = '#ffffff';
  const nombreAjustado = ajustarTexto(ctx, nom, 'SelloSansBold', Math.round(W * 0.056), 26, W - margen * 2);
  ctx.fillText(nombreAjustado, cx, alto + banda * 0.59);

  ctx.fillStyle = DORADO;
  ctx.font = `${Math.round(W * 0.023)}px SelloSans`;
  const pie = [tel && `Tel. ${tel}`, codigo && `Compra ${codigo}`, 'No transferible'].filter(Boolean).join('  ·  ');
  ctx.fillText(pie, cx, alto + banda * 0.86);

  return canvas.encode('jpeg', calidad);
}

module.exports = { sellarTabla, formatearTelefono };
