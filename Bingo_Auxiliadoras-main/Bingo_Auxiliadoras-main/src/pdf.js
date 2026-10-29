// PDF para imprimir: tamaño carta, 4 tablas por hoja (2 x 2), con líneas punteadas de corte.
// Cada imagen ya viene sellada con el nombre y teléfono del comprador (src/sello.js).
const { PDFDocument, rgb } = require('pdf-lib');

const CARTA = { ancho: 612, alto: 792 }; // puntos (8,5 x 11 pulgadas)
const MARGEN = 24;
const POR_HOJA = 4;

// jpegs: Buffer[] en el orden en que deben imprimirse. Devuelve Uint8Array con el PDF.
async function armarPdf(jpegs, { titulo = 'Tablas del bingo' } = {}) {
  if (!jpegs.length) throw new Error('No hay tablas para el PDF.');
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setCreator('Bingo HACS');

  const celdaAncho = (CARTA.ancho - MARGEN * 2) / 2;
  const celdaAlto = (CARTA.alto - MARGEN * 2) / 2;

  for (let i = 0; i < jpegs.length; i += POR_HOJA) {
    const pagina = doc.addPage([CARTA.ancho, CARTA.alto]);
    // Líneas de corte, tenues y punteadas, en la cruz central de la hoja.
    const gris = rgb(0.75, 0.78, 0.8);
    pagina.drawLine({ start: { x: CARTA.ancho / 2, y: MARGEN / 2 }, end: { x: CARTA.ancho / 2, y: CARTA.alto - MARGEN / 2 }, thickness: 0.5, color: gris, dashArray: [4, 4] });
    pagina.drawLine({ start: { x: MARGEN / 2, y: CARTA.alto / 2 }, end: { x: CARTA.ancho - MARGEN / 2, y: CARTA.alto / 2 }, thickness: 0.5, color: gris, dashArray: [4, 4] });

    for (let k = 0; k < POR_HOJA && i + k < jpegs.length; k++) {
      const imagen = await doc.embedJpg(jpegs[i + k]);
      // Cada tabla cabe en su cuarto de hoja conservando la proporción, centrada en la celda.
      const factor = Math.min((celdaAncho - 12) / imagen.width, (celdaAlto - 12) / imagen.height);
      const w = imagen.width * factor;
      const h = imagen.height * factor;
      const col = k % 2;
      const fila = Math.floor(k / 2);
      const x = MARGEN + col * celdaAncho + (celdaAncho - w) / 2;
      const y = CARTA.alto - MARGEN - (fila + 1) * celdaAlto + (celdaAlto - h) / 2;
      pagina.drawImage(imagen, { x, y, width: w, height: h });
    }
  }
  return doc.save();
}

module.exports = { armarPdf, POR_HOJA };
