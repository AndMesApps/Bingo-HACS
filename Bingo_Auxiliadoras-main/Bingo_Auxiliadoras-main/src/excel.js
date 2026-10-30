// Libros de Excel (.xlsx) con la identidad del Bingo: título con logo, encabezados en azul HACS, filas alternadas,
// formato de dinero y fechas, totales con fórmulas, filtros, panel congelado y listo para imprimir.
const path = require('node:path');
const ExcelJS = require('exceljs');

const COLOR = {
  marino: 'FF0F3448', azul: 'FF106080', dorado: 'FFC9A24B', doradoClaro: 'FFFBF3DC', blanco: 'FFFFFFFF',
  cebra: 'FFF2F6F8', borde: 'FFD0D7DB', total: 'FFE3EEF3', texto: 'FF1D2A33',
  verde: 'FFE2F3E7', verdeTexto: 'FF1B6E3A', ambar: 'FFFFF1CC', ambarTexto: 'FF8A5A00', rojo: 'FFFBE3E3', rojoTexto: 'FFA12B2B',
};

const LOGO = path.join(__dirname, '..', 'public', 'img', 'logo-hacs.jpg');

// Nombres legibles para los estados que guarda el sistema.
const ESTADOS = {
  por_verificar: 'Por verificar', verificada: 'Verificada', enviada: 'Enviada', rechazada: 'Rechazada', donacion: 'Donación',
  verificado: 'Verificado', rechazado: 'Rechazado', no_enviado: 'No enviado', enviado: 'Enviado', manual: 'Manual pendiente',
  fallido: 'Fallido', no: 'No aplica', pendiente: 'Pendiente', entregada: 'Entregada', disponible: 'Disponible', vendida: 'Vendida',
  por_definir: 'Por definir', donado: 'Donado', por_devolver: 'Por devolver', devuelto: 'Devuelto', ninguno: '—',
  entregado: 'Entregado', 'por entregar': 'Por entregar', 'sin ganador': 'Sin ganador', 'en revisión': 'En revisión',
};
const VERDES = new Set(['Verificada', 'Enviada', 'Donación', 'Verificado', 'Enviado', 'Entregada', 'Entregado', 'Vendida', 'Donado', 'Devuelto']);
const AMBARES = new Set(['Por verificar', 'No enviado', 'Manual pendiente', 'Pendiente', 'Por definir', 'Por devolver', 'Por entregar', 'En revisión']);
const ROJOS = new Set(['Rechazada', 'Rechazado', 'Fallido']);

const FORMATO = { texto: '@', entero: '#,##0', fecha: 'dd/mm/yyyy' };

// Tipo de cada columna de los reportes (por nombre de reporte y posición).
const TIPOS_REPORTE = {
  compras: ['texto', 'fecha', 'texto', 'texto', 'texto', 'texto', 'texto', 'texto', 'entero', 'entero', 'dinero', 'dinero', 'dinero', 'estado', 'estado', 'estado', 'estado', 'largo'],
  pagos: ['fecha', 'texto', 'texto', 'dinero', 'dinero', 'texto', 'texto', 'estado'],
  deudas: ['texto', 'texto', 'texto', 'texto', 'dinero', 'dinero', 'dinero'],
  sobrantes: ['texto', 'texto', 'texto', 'dinero', 'entero', 'dinero', 'texto', 'estado', 'largo', 'largo'],
  tablas: ['texto', 'estado', 'fecha', 'texto', 'texto', 'texto', 'texto'],
  premios: ['texto', 'texto', 'texto', 'dinero', 'texto', 'texto', 'texto', 'texto', 'estado', 'texto', 'largo'],
  gastos: ['fecha', 'texto', 'texto', 'dinero'],
};
const TITULOS_REPORTE = {
  compras: 'Compras', pagos: 'Pagos', deudas: 'Deudas', sobrantes: 'Sobrantes', tablas: 'Tablas', premios: 'Premios', gastos: 'Gastos',
};
// Columnas que se suman en la fila de totales.
const TOTALES_REPORTE = { compras: [8, 9, 10, 11, 12], pagos: [3, 4], deudas: [4, 5, 6], sobrantes: [3, 4, 5], premios: [3], gastos: [3] };

const letra = n => { let s = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

const aFecha = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};

// Una hoja con título, tabla con encabezados, filas alternadas y (opcional) totales.
//  columnas: [{ encabezado, tipo: texto|entero|dinero|fecha|estado|largo, ancho? }]
//  filas: arreglo de arreglos (en el orden de las columnas)
//  opciones: { nombreHoja, titulo, subtitulo, totales: [índices de columna], destacadas: [índices de fila], moneda, vacio }
function agregarHoja(libro, logoId, columnas, filas, opciones) {
  const ws = libro.addWorksheet(opciones.nombreHoja.slice(0, 31), { properties: { tabColor: { argb: COLOR.azul } } });
  const n = columnas.length;
  const moneda = opciones.moneda ? String(opciones.moneda).trim() : '';
  const todoEntero = filas.every(f => columnas.every((c, i) => c.tipo !== 'dinero' || Number.isInteger(Number(f[i] || 0))));
  const fmtDinero = `${moneda ? `"${moneda.replace(/"/g, '')}" ` : ''}#,##0${todoEntero ? '' : '.00'}`;
  const fmt = tipo => (tipo === 'dinero' ? fmtDinero : FORMATO[tipo]);
  const borde = { style: 'thin', color: { argb: COLOR.borde } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };
  const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  // --- Cabecera de la hoja: logo + título + subtítulo + filete dorado ---
  ws.getRow(1).height = 38;
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 5;
  for (let c = 1; c <= n; c++) {
    ws.getCell(1, c).fill = relleno(COLOR.marino);
    ws.getCell(2, c).fill = relleno(COLOR.marino);
    ws.getCell(3, c).fill = relleno(COLOR.dorado);
  }
  if (n > 1) { ws.mergeCells(1, 2, 1, n); ws.mergeCells(2, 2, 2, n); }
  const titulo = ws.getCell(1, n > 1 ? 2 : 1);
  titulo.value = opciones.titulo;
  titulo.font = { name: 'Calibri', size: 18, bold: true, color: { argb: COLOR.blanco } };
  titulo.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  const sub = ws.getCell(2, n > 1 ? 2 : 1);
  sub.value = opciones.subtitulo;
  sub.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFE8D9A8' } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  if (logoId != null) ws.addImage(logoId, { tl: { col: 0.12, row: 0.1 }, ext: { width: 66, height: 66 } });

  // --- Encabezados de la tabla ---
  const filaEnc = 4;
  const enc = ws.getRow(filaEnc);
  enc.height = 30;
  columnas.forEach((col, i) => {
    const cel = enc.getCell(i + 1);
    cel.value = col.encabezado;
    cel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR.blanco } };
    cel.fill = relleno(COLOR.azul);
    cel.alignment = { vertical: 'middle', horizontal: col.tipo === 'dinero' || col.tipo === 'entero' ? 'right' : 'left', wrapText: true, indent: 0 };
    cel.border = bordes;
  });

  // --- Filas de datos ---
  const destacadas = new Set(opciones.destacadas || []);
  filas.forEach((f, r) => {
    const fila = ws.getRow(filaEnc + 1 + r);
    fila.height = columnas.some(c => c.tipo === 'largo') ? 30 : 21;
    columnas.forEach((col, i) => {
      const cel = fila.getCell(i + 1);
      let v = f[i];
      if (col.tipo === 'fecha') v = aFecha(v) ?? (v === '' || v == null ? null : v);
      else if (col.tipo === 'dinero' || col.tipo === 'entero') v = v === '' || v == null ? null : Number(v);
      else if (col.tipo === 'estado') v = ESTADOS[v] ?? (v == null ? '' : String(v));
      else v = v == null ? '' : String(v);
      cel.value = v;
      const fmtCel = fmt(col.tipo);
      if (fmtCel) cel.numFmt = fmtCel;
      cel.font = { name: 'Calibri', size: 11, color: { argb: COLOR.texto }, bold: destacadas.has(r) };
      cel.alignment = { vertical: 'middle', horizontal: col.tipo === 'dinero' || col.tipo === 'entero' ? 'right' : col.tipo === 'estado' || col.tipo === 'fecha' ? 'center' : 'left', wrapText: col.tipo === 'largo' };
      cel.border = bordes;
      cel.fill = relleno(destacadas.has(r) ? COLOR.doradoClaro : r % 2 === 1 ? COLOR.cebra : COLOR.blanco);
      if (col.tipo === 'estado' && typeof v === 'string') {
        const [bg, fg] = VERDES.has(v) ? [COLOR.verde, COLOR.verdeTexto] : AMBARES.has(v) ? [COLOR.ambar, COLOR.ambarTexto] : ROJOS.has(v) ? [COLOR.rojo, COLOR.rojoTexto] : [null, null];
        if (bg) { cel.fill = relleno(bg); cel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: fg } }; }
      }
    });
  });

  // --- Sin datos ---
  let ultima = filaEnc + filas.length;
  if (!filas.length) {
    ultima = filaEnc + 1;
    if (n > 1) ws.mergeCells(ultima, 1, ultima, n);
    const cel = ws.getCell(ultima, 1);
    cel.value = opciones.vacio || 'No hay datos para mostrar.';
    cel.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF5A6B75' } };
    cel.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(ultima).height = 26;
  }

  // --- Totales (con fórmula, y su resultado guardado para quien lo abra sin recalcular) ---
  const totales = (opciones.totales || []).filter(i => i < n);
  if (filas.length && totales.length) {
    const ft = ultima + 1;
    const fila = ws.getRow(ft);
    fila.height = 26;
    for (let i = 0; i < n; i++) {
      const cel = fila.getCell(i + 1);
      cel.fill = relleno(COLOR.total);
      cel.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR.marino } };
      cel.border = { top: { style: 'medium', color: { argb: COLOR.azul } }, bottom: borde, left: borde, right: borde };
      cel.alignment = { vertical: 'middle', horizontal: columnas[i].tipo === 'dinero' || columnas[i].tipo === 'entero' ? 'right' : 'left' };
    }
    fila.getCell(1).value = 'TOTAL';
    for (const i of totales) {
      const suma = filas.reduce((t, f) => t + (Number(f[i]) || 0), 0);
      const cel = fila.getCell(i + 1);
      cel.value = { formula: `SUM(${letra(i)}${filaEnc + 1}:${letra(i)}${ultima})`, result: suma };
      cel.numFmt = fmt(columnas[i].tipo) || '#,##0';
    }
    ultima = ft;
  }

  // --- Anchos: según el contenido, con tope ---
  columnas.forEach((col, i) => {
    let ancho = String(col.encabezado).length + 4;
    for (const f of filas) {
      const v = f[i];
      const len = col.tipo === 'dinero' ? String(Math.round(Number(v) || 0)).length + 6 : col.tipo === 'fecha' ? 12 : col.tipo === 'estado' ? 18 : String(v ?? '').length + 2;
      if (len > ancho) ancho = len;
    }
    const tope = col.tipo === 'largo' ? 48 : 38;
    ws.getColumn(i + 1).width = Math.max(col.ancho || 0, Math.min(tope, Math.max(i === 0 ? 14 : 11, ancho)));
  });

  // --- Comodidades: panel congelado, filtros y configuración de impresión ---
  ws.views = [{ state: 'frozen', ySplit: filaEnc, showGridLines: false }];
  if (filas.length && !opciones.sinFiltro) ws.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: filaEnc + filas.length, column: n } };
  ws.pageSetup = {
    orientation: n > 6 ? 'landscape' : 'portrait', paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: `${filaEnc}:${filaEnc}`, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = { oddFooter: '&L&8Hermanas Auxiliadoras de Cristo Sacerdote&C&8Página &P de &N&R&8&D' };
  return ws;
}

function nuevoLibro() {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Bingo · Hermanas Auxiliadoras de Cristo Sacerdote';
  libro.created = new Date();
  const logoId = (() => { try { return libro.addImage({ filename: LOGO, extension: 'jpeg' }); } catch { return null; } })();
  return { libro, logoId };
}

const fechaLarga = () => new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
const subtituloBase = (extra = '') => `Hermanas Auxiliadoras de Cristo Sacerdote · Generado el ${fechaLarga()}${extra}`;

// items: [{ clave, data }] con data = resultado de servicios.reporte(clave) ({ encabezados, filas, bingo, moneda })
async function libroDeReportes(items) {
  const { libro, logoId } = nuevoLibro();
  for (const { clave, data } of items) {
    const tipos = TIPOS_REPORTE[clave];
    if (!tipos) throw new Error(`Reporte desconocido: ${clave}`);
    const columnas = data.encabezados.map((encabezado, i) => ({ encabezado, tipo: tipos[i] || 'texto' }));
    agregarHoja(libro, logoId, columnas, data.filas, {
      nombreHoja: TITULOS_REPORTE[clave], moneda: data.moneda, totales: TOTALES_REPORTE[clave],
      titulo: `${data.bingo} — ${TITULOS_REPORTE[clave]}`, subtitulo: subtituloBase(),
      vacio: 'Todavía no hay datos en este reporte.',
    });
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

// inf: resultado de servicios.informes()
async function libroDeInformes(inf) {
  const { libro, logoId } = nuevoLibro();
  const moneda = inf.moneda;
  const periodo = inf.desde || inf.hasta ? ` · Periodo: ${inf.desde || 'inicio'} a ${inf.hasta || 'hoy'}` : ' · Todo el Bingo';
  const base = { moneda, subtitulo: subtituloBase(periodo) };
  const titulo = t => `${inf.bingo.nombre} — ${t}`;
  const m = inf.resultados;

  agregarHoja(libro, logoId, [{ encabezado: 'Concepto', tipo: 'texto', ancho: 44 }, { encabezado: 'Valor', tipo: 'dinero', ancho: 20 }], [
    ['Cobrado (pagos verificados)', m.cobrado],
    ['(−) Sobrantes por devolver', -m.porDevolver],
    ['(−) Sobrantes ya devueltos', -m.devuelto],
    ['INGRESOS DEL BINGO', m.ingresos],
    ['     de los cuales: ventas de tablas', m.ventasTablas],
    ['     de los cuales: donaciones', m.donaciones],
    ['(−) Premios entregados', -m.premiosPagados],
    ['(−) Gastos', -m.gastos],
    ['EXCEDENTE NETO', m.excedente],
    ['(−) Premios aún por entregar', -m.premiosPendientes],
    ['EXCEDENTE PROYECTADO', m.excedenteProyectado],
  ], { ...base, nombreHoja: 'Estado de resultados', titulo: titulo('Estado de resultados'), destacadas: [3, 8, 10], sinFiltro: true });

  const metodos = inf.caja.metodos;
  agregarHoja(libro, logoId,
    [{ encabezado: 'Día', tipo: 'fecha' }, ...metodos.map(mt => ({ encabezado: mt, tipo: 'dinero' })), { encabezado: 'Total del día', tipo: 'dinero' }, { encabezado: 'Pagos', tipo: 'entero' }],
    inf.caja.dias.map(d => [d.dia, ...metodos.map(mt => d.porMetodo[mt] || 0), d.total, d.pagos]),
    { ...base, nombreHoja: 'Caja por día', titulo: titulo('Caja por día y método de pago'), totales: Array.from({ length: metodos.length + 2 }, (_, i) => i + 1), vacio: 'No hay pagos verificados en este periodo.' });

  agregarHoja(libro, logoId, [{ encabezado: 'Estado del pago', tipo: 'texto', ancho: 24 }, { encabezado: 'Cantidad', tipo: 'entero' }, { encabezado: 'Valor', tipo: 'dinero' }],
    inf.pagosEstado.map(x => [ESTADOS[x.clave] || x.clave, x.cantidad, x.monto]),
    { ...base, nombreHoja: 'Pagos', titulo: titulo('Estado de los pagos'), totales: [1, 2] });

  const ventas = (clave, nombreCol, nombreHoja, tituloHoja, tipo = 'texto') => agregarHoja(libro, logoId,
    [{ encabezado: nombreCol, tipo, ancho: 28 }, { encabezado: 'Compras', tipo: 'entero' }, { encabezado: 'Tablas', tipo: 'entero' }, { encabezado: 'Valor', tipo: 'dinero' }],
    inf[clave].map(x => [x.clave, x.compras, x.tablas, x.monto]),
    { ...base, nombreHoja, titulo: titulo(tituloHoja), totales: [1, 2, 3], vacio: 'No hay ventas en este periodo.' });
  ventas('ventasPorDia', 'Día', 'Ventas por día', 'Ventas por día (tablas enviadas)', 'fecha');
  ventas('porReferido', 'Referido por', 'Por referido', 'Ventas por referido (quién trajo al benefactor)');
  ventas('porCiudad', 'Ciudad', 'Por ciudad', 'Ventas por ciudad');

  agregarHoja(libro, logoId, [{ encabezado: 'Categoría', tipo: 'texto', ancho: 28 }, { encabezado: 'Registros', tipo: 'entero' }, { encabezado: 'Valor', tipo: 'dinero' }],
    inf.gastosPorCategoria.map(x => [x.clave, x.cantidad, x.monto]),
    { ...base, nombreHoja: 'Gastos', titulo: titulo('Gastos por categoría'), totales: [1, 2], vacio: 'No hay gastos en este periodo.' });

  agregarHoja(libro, logoId,
    [{ encabezado: 'Ronda', tipo: 'texto' }, { encabezado: 'Premio', tipo: 'texto', ancho: 24 }, { encabezado: 'Figura', tipo: 'texto', ancho: 30 }, { encabezado: 'Valor', tipo: 'dinero' },
      { encabezado: 'Tabla', tipo: 'texto' }, { encabezado: 'Ganador', tipo: 'texto', ancho: 24 }, { encabezado: 'Estado', tipo: 'estado' }, { encabezado: 'Recibió', tipo: 'texto', ancho: 26 }],
    inf.premios.map(x => [x.ronda, x.premio, x.figura, x.monto, x.serial, x.ganador, x.estado, x.recibidoPor]),
    { ...base, nombreHoja: 'Premios', titulo: titulo('Premios'), totales: [3], vacio: 'Todavía no hay premios creados.' });

  const t = inf.tablas;
  const entregas = [];
  for (const [canal, lista] of [['WhatsApp', t.whatsapp], ['Correo', t.correo], ['Entrega física', t.fisica]]) {
    for (const x of lista) entregas.push([canal, x.clave, x.cantidad]);
  }
  agregarHoja(libro, logoId, [{ encabezado: 'Concepto', tipo: 'texto', ancho: 26 }, { encabezado: 'Estado', tipo: 'estado' }, { encabezado: 'Cantidad', tipo: 'entero' }],
    [['Tablas vendidas', 'ninguno', t.vendidas], ...(t.disponibles == null ? [] : [['Tablas disponibles', 'ninguno', t.disponibles]]), ['Tablas por enviar', 'ninguno', t.porEnviar], ...entregas],
    { ...base, nombreHoja: 'Tablas y entregas', titulo: titulo('Control de tablas y entregas'), subtitulo: subtituloBase(' · Estado actual') });

  return Buffer.from(await libro.xlsx.writeBuffer());
}

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

module.exports = { libroDeReportes, libroDeInformes, TIPO_XLSX, TITULOS_REPORTE };
