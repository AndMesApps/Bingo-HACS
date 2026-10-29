const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { desdePglite } = require('../src/db');
const { crearServicios, ErrorApp } = require('../src/servicios');
const { crearWhatsApp } = require('../src/whatsapp');

const ESQUEMA = fs.readFileSync(path.join(__dirname, '..', 'src', 'esquema.sql'), 'utf8');

async function nuevo({ whatsapp, correo } = {}) {
  const pg = new PGlite();
  const db = desdePglite(pg);
  await db.exec(ESQUEMA);
  const s = crearServicios({ db, whatsapp: whatsapp || crearWhatsApp({}), ...(correo ? { correo } : {}) });
  await s.actualizarEvento({ nombre: 'Prueba', precioTabla: 10, moneda: 'USD' });
  s.db = db;
  return s;
}

const ruta = () => `comprobantes/${require('node:crypto').randomBytes(16).toString('hex')}.png`;
const comprobante = () => [{ ruta: ruta(), nombre: 'pago.png', tipo: 'image/png' }];

const datos = (n, extra = {}) => ({
  nombre: 'Ana Pérez', telefono: '04121234567', correo: 'a@x.com', ciudad: 'Medellín', referidoPor: 'Hna. María',
  cantidad: n, montoPagado: n * 10, fechaPago: new Date().toISOString().slice(0, 10),
  metodo: 'Consignación', referencia: 'REF' + Math.random(), sobranteDestino: 'donacion', ...extra,
});

async function tablas(s, n) {
  await s.importarTablas(Array.from({ length: n }, (_, i) => `TBL-${String(i).padStart(4, '0')}`).join('\n'));
}

async function comprar(s, n, extra = {}) {
  const c = await s.crearCompra(datos(n, extra), comprobante());
  return c;
}

async function verificarTodo(s, compraId, monto) {
  const d = await s.detalleCompra(compraId);
  return s.verificarPago(d.pagos[0].id, monto ?? d.total);
}

test('no se puede enviar una tabla dos veces', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const a = await comprar(s, 3);
  const b = await comprar(s, 2);
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  const ea = await s.enviarTablas(a.id);
  const eb = await s.enviarTablas(b.id);
  const todas = [...ea.tablas, ...eb.tablas];
  assert.equal(new Set(todas).size, 5);
  assert.equal((await s.resumen()).tablas.disponibles, 0);
});

test('envíos simultáneos reciben tablas distintas', async () => {
  const s = await nuevo();
  await tablas(s, 4);
  const a = await comprar(s, 2);
  const b = await comprar(s, 2);
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  const [ea, eb] = await Promise.all([s.enviarTablas(a.id), s.enviarTablas(b.id)]);
  const todas = [...ea.tablas, ...eb.tablas];
  assert.equal(new Set(todas).size, 4, 'ninguna tabla se repite');
  assert.equal((await s.listarTablas()).filter(t => t.estado === 'vendida').length, 4);
});

test('no se vende más de lo que hay disponible', async () => {
  const s = await nuevo();
  await tablas(s, 4);
  await comprar(s, 3);
  await assert.rejects(comprar(s, 2), err => err instanceof ErrorApp && err.status === 409);
});

test('rechazar compra libera las tablas comprometidas', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const c = await comprar(s, 2);
  assert.equal(await s.tablasLibresParaVender(), 0);
  await s.rechazarCompra(c.id);
  assert.equal(await s.tablasLibresParaVender(), 2);
});

test('enviar exige pago verificado y compra verificada', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const c = await comprar(s, 1);
  await assert.rejects(s.enviarTablas(c.id), /verificadas/);
  await verificarTodo(s, c.id);
  const enviada = await s.enviarTablas(c.id);
  assert.equal(enviada.estado, 'enviada');
  await assert.rejects(s.enviarTablas(c.id), /verificadas/);
});

test('saldo y deuda con pagos parciales', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const c = await comprar(s, 3, { montoPagado: 12 });
  await verificarTodo(s, c.id, 12);
  let d = await s.detalleCompra(c.id);
  assert.equal(d.total, 30);
  assert.equal(d.pagado, 12);
  assert.equal(d.saldo, 18);
  assert.equal((await s.resumen()).dinero.porCobrar, 18);
  await s.registrarPagoManual(c.id, { monto: 18, metodo: 'Efectivo' });
  d = await s.detalleCompra(c.id);
  assert.equal(d.saldo, 0);
  assert.equal(d.estado, 'verificada');
});

test('verificar con monto 0 o pago ya procesado falla', async () => {
  const s = await nuevo();
  await tablas(s, 1);
  const c = await comprar(s, 1);
  const pid = (await s.detalleCompra(c.id)).pagos[0].id;
  await assert.rejects(s.verificarPago(pid, 0), /mayor que 0/);
  await s.verificarPago(pid, 10);
  await assert.rejects(s.verificarPago(pid, 10), /ya fue procesado/);
});

test('no se rechaza una compra con dinero verificado', async () => {
  const s = await nuevo();
  await tablas(s, 1);
  const c = await comprar(s, 1);
  await verificarTodo(s, c.id);
  await assert.rejects(s.rechazarCompra(c.id), /devolución/);
});

test('premio: solo tabla vendida y de compra real', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const c = await comprar(s, 1);
  await verificarTodo(s, c.id);
  const p = await s.crearPremio({ ronda: 'Línea', premio: 'Cena', monto: 50 });
  await assert.rejects(s.asignarGanador(p.id, 'TBL-0000'), /no está vendida/);
  await assert.rejects(s.asignarGanador(p.id, 'NO-EXISTE'), /no existe/);
  const enviada = await s.enviarTablas(c.id);
  const g = await s.asignarGanador(p.id, enviada.tablas[0]);
  assert.equal(g.ganador.nombre, 'Ana Pérez');
  await s.pagarPremio(p.id);
  assert.equal((await s.resumen()).dinero.premiosPagados, 50);
});

test('balance en caja = cobrado - premios pagados - gastos', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  const c = await comprar(s, 3);
  await verificarTodo(s, c.id, 30);
  await s.crearGasto({ concepto: 'Sala', monto: 8, categoria: 'Logística' });
  assert.equal((await s.resumen()).dinero.balance, 22);
});

test('teléfono venezolano se normaliza y se valida', async () => {
  const s = await nuevo();
  await tablas(s, 1);
  const c = await comprar(s, 1, { telefono: '0412-123 4567' });
  assert.equal((await s.detalleCompra(c.id)).telefono, '584121234567');
  await assert.rejects(comprar(s, 1, { telefono: '12' }), /no es válido/);
});

test('compra exige al menos un comprobante', async () => {
  const s = await nuevo();
  await tablas(s, 1);
  await assert.rejects(s.crearCompra(datos(1), []), /comprobante/);
});

test('el comprobante queda ligado al pago', async () => {
  const s = await nuevo();
  await tablas(s, 1);
  const c = await comprar(s, 1);
  const d = await s.detalleCompra(c.id);
  assert.equal(d.pagos[0].comprobantes.length, 1);
  assert.equal(d.pagos[0].comprobantes[0].nombre, 'pago.png');
});

test('generar tablas no repite seriales y respeta límites', async () => {
  const s = await nuevo();
  assert.equal((await s.generarTablas(120)).creadas, 120);
  assert.equal(await s.tablasDisponibles(), 120);
  await assert.rejects(s.generarTablas(501), /entre 1 y 500/);
  const seriales = (await s.listarTablas()).map(t => t.serial);
  assert.equal(new Set(seriales).size, 120);
});

test('importar ignora repetidos y vacíos', async () => {
  const s = await nuevo();
  const r = await s.importarTablas('BNG-A\nbng-a\n\nBNG-B, BNG-C');
  assert.deepEqual([r.leidas, r.insertadas, r.repetidas], [3, 3, 0]);
  const r2 = await s.importarTablas('BNG-A,BNG-D');
  assert.deepEqual([r2.insertadas, r2.repetidas], [1, 1]);
});

test('reporte de deudas solo incluye saldos positivos', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  await comprar(s, 1);
  const r = await s.reporte('deudas');
  assert.equal(r.filas.length, 1);
  await assert.rejects(s.reporte('nada'), /no existe/);
});

test('si WhatsApp falla la compra queda enviada y se reintenta con las mismas tablas', async () => {
  let intentos = 0;
  const whatsapp = {
    normalizarTelefono: t => String(t).replace(/\D/g, ''),
    enviarTablas: async () => { intentos++; if (intentos === 1) throw new Error('caída'); return { estado: 'enviado' }; },
    enlaceManual: () => 'https://wa.me/x',
  };
  const s = await nuevo({ whatsapp });
  await tablas(s, 1);
  const c = await comprar(s, 1);
  await verificarTodo(s, c.id);
  const e1 = await s.enviarTablas(c.id);
  assert.equal(e1.estado, 'enviada');
  assert.equal(e1.whatsappEstado, 'fallido');
  const e2 = await s.reenviar(c.id, { canales: { whatsapp: true } });
  assert.equal(e2.whatsappEstado, 'enviado');
  assert.deepEqual(e2.tablas, e1.tablas);
});


// ---------- v3: monto → tablas, control estricto, canales de entrega ----------

test('el sistema sugiere tablas según lo pagado y el verificador no puede enviar más de lo pagado', async () => {
  const s = await nuevo();
  await tablas(s, 10);
  const r = await s.crearCompra(datos(3, { montoPagado: 25 }), comprobante());
  assert.equal(r.tablasSugeridas, 2);
  await verificarTodo(s, r.id, 25);
  const antes = await s.detalleCompra(r.id);
  assert.equal(antes.tablasSugeridas, 2);
  await assert.rejects(s.enviarTablas(r.id, { cantidad: 3 }), /cubre solo 2/);
  assert.equal(await s.tablasDisponibles(), 10, 'el intento fallido no asigna nada');
  const e = await s.enviarTablas(r.id); // por defecto, lo que cubre el pago
  assert.equal(e.tablas.length, 2);
  assert.equal(e.tablasAprobadas, 2);
  assert.equal(e.total, 20);
});

test('el verificador puede enviar menos tablas de las pedidas', async () => {
  const s = await nuevo();
  await tablas(s, 10);
  const r = await comprar(s, 5);
  await verificarTodo(s, r.id);
  const e = await s.enviarTablas(r.id, { cantidad: 2 });
  assert.equal(e.tablas.length, 2);
  assert.equal(await s.tablasDisponibles(), 8);
});

test('sin exigir pago completo se pueden enviar tablas a deber', async () => {
  const s = await nuevo();
  await s.actualizarEvento({ exigirPagoCompleto: false });
  await tablas(s, 5);
  const r = await comprar(s, 3, { montoPagado: 10 });
  await verificarTodo(s, r.id, 10);
  const e = await s.enviarTablas(r.id, { cantidad: 3 });
  assert.equal(e.tablas.length, 3);
  assert.equal(e.saldo, 20);
});

test('efectivo: no exige comprobante; la consignación sí', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const c = await s.crearCompra(datos(1, { metodo: 'Efectivo', fechaPago: undefined }), []);
  assert.equal((await s.detalleCompra(c.id)).pagos[0].metodo, 'Efectivo');
  await assert.rejects(s.crearCompra(datos(1), []), /comprobante/);
});

test('el formulario valida ciudad, referido, fecha y correo; cédula y correo son opcionales', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await assert.rejects(s.crearCompra(datos(1, { ciudad: '' }), comprobante()), /ciudad/i);
  await assert.rejects(s.crearCompra(datos(1, { referidoPor: ' ' }), comprobante()), /bingo/i);
  await assert.rejects(s.crearCompra(datos(1, { fechaPago: '' }), comprobante()), /fecha/i);
  await assert.rejects(s.crearCompra(datos(1, { fechaPago: '2999-01-01' }), comprobante()), /futura/);
  await assert.rejects(s.crearCompra(datos(1, { correo: 'no-es-correo' }), comprobante()), /correo/i);
  await assert.rejects(s.crearCompra(datos(1, { montoPagado: 0 }), comprobante()), /mayor que 0/);
  const c = await s.crearCompra(datos(1, { correo: '', cedula: undefined }), comprobante());
  const d = await s.detalleCompra(c.id);
  assert.equal(d.correo, '');
  assert.equal(d.ciudad, 'Medellín');
  assert.equal(d.referidoPor, 'Hna. María');
});

test('control estricto: la base rechaza reasignar, liberar o borrar una tabla vendida', async () => {
  const s = await nuevo();
  await tablas(s, 4);
  const a = await comprar(s, 1);
  const b = await comprar(s, 1);
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  const ea = await s.enviarTablas(a.id);
  await s.enviarTablas(b.id);
  const serial = ea.tablas[0];
  await assert.rejects(s.db.query('UPDATE tablas SET compra_id = $1 WHERE serial = $2', [b.id, serial]), /no se puede reasignar/);
  await assert.rejects(s.db.query("UPDATE tablas SET estado = 'disponible', compra_id = NULL WHERE serial = $1", [serial]), /no se puede reasignar/);
  await assert.rejects(s.db.query('DELETE FROM tablas WHERE serial = $1', [serial]), /no se puede borrar/);
  // Estado incoherente: vendida sin compra, o disponible con compra.
  await assert.rejects(s.db.query("UPDATE tablas SET estado = 'vendida' WHERE estado = 'disponible'"), /coherente/);
  await assert.rejects(s.db.query('UPDATE tablas SET compra_id = $1 WHERE estado = \'disponible\'', [a.id]), /coherente/);
  const dueño = await s.db.query('SELECT compra_id FROM tablas WHERE serial = $1', [serial]);
  assert.equal(dueño[0].compra_id, a.id);
});

test('control estricto: muchos envíos simultáneos nunca repiten una tabla', async () => {
  const s = await nuevo();
  await tablas(s, 90);
  const ids = [];
  for (let i = 0; i < 30; i++) {
    const c = await comprar(s, 3);
    await verificarTodo(s, c.id);
    ids.push(c.id);
  }
  const resultados = await Promise.all(ids.map(id => s.enviarTablas(id)));
  const todas = resultados.flatMap(r => r.tablas);
  assert.equal(todas.length, 90);
  assert.equal(new Set(todas).size, 90, 'ninguna tabla se asignó dos veces');
  const huerfanas = await s.db.query("SELECT COUNT(*)::int AS n FROM tablas WHERE estado = 'vendida' AND compra_id IS NULL");
  assert.equal(huerfanas[0].n, 0);
});

test('una compra no se envía dos veces aunque se pida a la vez', async () => {
  const s = await nuevo();
  await tablas(s, 6);
  const c = await comprar(s, 2);
  await verificarTodo(s, c.id);
  const r = await Promise.allSettled([s.enviarTablas(c.id), s.enviarTablas(c.id)]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await s.listarTablas()).filter(t => t.estado === 'vendida').length, 2);
});

test('si no alcanzan las tablas, el envío falla completo y no asigna nada', async () => {
  const s = await nuevo();
  await s.actualizarEvento({ exigirPagoCompleto: false });
  await tablas(s, 2);
  const c = await comprar(s, 2);
  await verificarTodo(s, c.id);
  await assert.rejects(s.enviarTablas(c.id, { cantidad: 5 }), /Faltan tablas/);
  assert.equal(await s.tablasDisponibles(), 2);
  assert.equal((await s.detalleCompra(c.id)).estado, 'verificada');
});

test('canales: correo exige correo registrado, entrega física queda pendiente y se marca entregada', async () => {
  const enviados = [];
  const correo = {
    enviarTablas: async x => { enviados.push(x); return { estado: 'enviado' }; },
    enlaceManual: () => 'mailto:x',
  };
  const s = await nuevo({ correo });
  await tablas(s, 5);
  const sin = await s.crearCompra(datos(1, { correo: '' }), comprobante());
  await verificarTodo(s, sin.id);
  await assert.rejects(s.enviarTablas(sin.id, { canales: { correo: true } }), /correo registrado/);
  await assert.rejects(s.enviarTablas(sin.id, { canales: { whatsapp: false } }), /al menos un canal/);

  const c = await comprar(s, 2);
  await verificarTodo(s, c.id);
  const e = await s.enviarTablas(c.id, { canales: { correo: true, fisica: true }, baseUrl: 'https://bingo.test' });
  assert.equal(e.correoEstado, 'enviado');
  assert.equal(e.whatsappEstado, 'no_enviado');
  assert.equal(e.fisicaEstado, 'pendiente');
  assert.match(enviados[0].enlace, /^https:\/\/bingo\.test\/tablas\.html\?t=[a-f0-9]{32}$/);
  const f = await s.entregaFisica(c.id, { estado: 'entregada', nota: 'Recibió en la parroquia' });
  assert.equal(f.fisicaEstado, 'entregada');
  assert.equal(f.fisicaNota, 'Recibió en la parroquia');
  await assert.rejects(s.entregaFisica(c.id, { estado: 'otra' }), /no válido/);
});

test('enlace privado: solo muestra las tablas de esa compra y rechaza tokens falsos', async () => {
  const s = await nuevo();
  await tablas(s, 6);
  const a = await comprar(s, 2);
  const b = await comprar(s, 1, { nombre: 'Luis' });
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  const ea = await s.enviarTablas(a.id);
  const eb = await s.enviarTablas(b.id);
  assert.notEqual(ea.tokenEntrega, eb.tokenEntrega);
  const va = await s.entregaPublica(ea.tokenEntrega);
  assert.deepEqual(va.tablas, ea.tablas);
  assert.equal(va.nombre, 'Ana Pérez');
  assert.equal((await s.entregaPublica(eb.tokenEntrega)).tablas.length, 1);
  await assert.rejects(s.entregaPublica('0'.repeat(32)), /no válido/);
  await assert.rejects(s.entregaPublica("' OR 1=1 --"), /no válido/);
});

test('datos de pago configurables: cuenta, llave y QR validado; el precio nuevo no cambia compras previas', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const antes = await comprar(s, 1);
  const e = await s.actualizarEvento({
    precioTabla: 20000, moneda: '$', titularCuenta: 'Hermanas Auxiliadoras De Cristo Sacerdote', banco: 'Banco X',
    tipoCuenta: 'Ahorros', numeroCuenta: '11279075642', llavePago: '3001234567', qrPago: png,
  });
  assert.equal(e.precioTabla, 20000);
  assert.equal(e.numeroCuenta, '11279075642');
  assert.equal(e.tipoCuenta, 'Ahorros');
  assert.equal(e.llavePago, '3001234567');
  assert.equal(e.qrPago, png);
  const r = await s.resumen();
  assert.equal(r.evento.tieneQr, true);
  assert.equal(r.evento.qrPago, undefined, 'el resumen no arrastra la imagen');

  await assert.rejects(s.actualizarEvento({ tipoCuenta: 'Otra' }), /Ahorros o Corriente/);
  await assert.rejects(s.actualizarEvento({ qrPago: 'http://malo.example/qr.png' }), /QR/);
  await assert.rejects(s.actualizarEvento({ qrPago: 'data:image/svg+xml;base64,AAAA' }), /QR/);
  await assert.rejects(s.actualizarEvento({ qrPago: 'data:image/png;base64,' + 'A'.repeat(600001) }), /QR/);

  // Editar otro dato conserva el QR; una cadena vacía lo quita.
  assert.equal((await s.actualizarEvento({ precioTabla: 25000 })).qrPago, png);
  assert.equal((await s.actualizarEvento({ tipoCuenta: 'Corriente' })).tipoCuenta, 'Corriente');
  const despues = await comprar(s, 1, { montoPagado: 25000 });
  assert.equal((await s.detalleCompra(antes.id)).precioUnitario, 10);
  assert.equal((await s.detalleCompra(despues.id)).precioUnitario, 25000);
  assert.equal((await s.actualizarEvento({ qrPago: '' })).tieneQr, false);
});

// ---------- Sobrante: donación o devolución ----------
async function conSobrante(s, extra = {}, cantidadEnviar) {
  await tablas(s, 5);
  await s.actualizarEvento({ precioTabla: 20000 });
  const c = await s.crearCompra(datos(3, { montoPagado: 45000, ...extra }), comprobante());
  await verificarTodo(s, c.id, 45000);
  const e = await s.enviarTablas(c.id, { cantidad: cantidadEnviar });
  return { c, e };
}

test('pagar 45.000 con tablas de 20.000: derecho a 2 tablas y sobran 5.000', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await s.actualizarEvento({ precioTabla: 20000 });
  const c = await s.crearCompra(datos(3, { montoPagado: 45000, sobranteDestino: 'donacion' }), comprobante());
  assert.equal(c.tablasSugeridas, 2);
  assert.equal(c.sobrante, 5000);
});

test('si sobra dinero el comprador debe elegir donar o devolver; devolver exige una nota', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await s.actualizarEvento({ precioTabla: 20000 });
  const base = { montoPagado: 45000 };
  await assert.rejects(s.crearCompra(datos(2, { ...base, sobranteDestino: '' }), comprobante()), /donas|devolvamos/);
  await assert.rejects(s.crearCompra(datos(2, { ...base, sobranteDestino: 'otra' }), comprobante()), /donas|devolvamos/);
  await assert.rejects(s.crearCompra(datos(2, { ...base, sobranteDestino: 'devolucion', sobranteNota: ' ' }), comprobante()), /nota/i);
  await s.crearCompra(datos(2, { ...base, sobranteDestino: 'devolucion', sobranteNota: 'Llave 3001234567' }), comprobante());
  // Pago exacto: no se pide decisión. Pago menor a una tabla: se rechaza.
  await s.crearCompra(datos(2, { montoPagado: 40000, sobranteDestino: '' }), comprobante());
  await assert.rejects(s.crearCompra(datos(1, { montoPagado: 15000 }), comprobante()), /no alcanza/);
});

test('sobrante donado suma a los ingresos y no queda por devolver', async () => {
  const s = await nuevo();
  const { e } = await conSobrante(s, { sobranteDestino: 'donacion' });
  assert.equal(e.tablas.length, 2);
  assert.equal(e.sobranteMonto, 5000);
  assert.equal(e.sobranteEstado, 'donado');
  const d = (await s.resumen()).dinero;
  assert.equal(d.donaciones, 5000);
  assert.equal(d.porDevolver, 0);
  assert.equal(d.ingresos, 45000);
  assert.equal(d.balance, 45000);
});

test('sobrante por devolver: no cuenta como ingreso hasta resolverse; devuelto baja la caja', async () => {
  const s = await nuevo();
  const { c, e } = await conSobrante(s, { sobranteDestino: 'devolucion', sobranteNota: 'Nequi 3001234567' });
  assert.equal(e.sobranteEstado, 'por_devolver');
  assert.equal(e.sobranteNota, 'Nequi 3001234567');
  let d = (await s.resumen()).dinero;
  assert.equal(d.porDevolver, 5000);
  assert.equal(d.ingresos, 40000);
  await assert.rejects(s.gestionarSobrante(c.id, { accion: 'devuelto' }), /cómo se devolvió/);
  await assert.rejects(s.gestionarSobrante(c.id, { accion: 'donar' }), /No se puede pasar/);
  const r = await s.gestionarSobrante(c.id, { accion: 'devuelto', nota: 'Transferido el 28/10, ref 998877' });
  assert.equal(r.sobranteEstado, 'devuelto');
  assert.equal(r.sobranteResolucion, 'Transferido el 28/10, ref 998877');
  d = (await s.resumen()).dinero;
  assert.equal(d.porDevolver, 0);
  assert.equal(d.devuelto, 5000);
  assert.equal(d.balance, 40000, 'lo devuelto sale de la caja');
  await assert.rejects(s.gestionarSobrante(c.id, { accion: 'devuelto', nota: 'otra vez' }), /No se puede pasar/);
});

test('pago en efectivo registrado por el administrador: el sobrante queda por definir y el admin decide', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await s.actualizarEvento({ precioTabla: 20000 });
  const c = await s.crearCompra(datos(2, { montoPagado: 20000, sobranteDestino: '' }), comprobante());
  await s.registrarPagoManual(c.id, { monto: 45000, metodo: 'Efectivo' });
  const pagoInicial = (await s.detalleCompra(c.id)).pagos.find(p => p.estado === 'por_verificar');
  await s.rechazarPago(pagoInicial.id);
  const e = await s.enviarTablas(c.id);
  assert.equal(e.tablas.length, 2);
  assert.equal(e.sobranteEstado, 'por_definir');
  assert.equal((await s.resumen()).dinero.porDevolver, 5000);
  await assert.rejects(s.gestionarSobrante(c.id, { accion: 'por_devolver' }), /cuenta, llave/);
  const r = await s.gestionarSobrante(c.id, { accion: 'por_devolver', nota: 'Entregar en efectivo en la parroquia' });
  assert.equal(r.sobranteEstado, 'por_devolver');
  assert.equal(r.sobranteNota, 'Entregar en efectivo en la parroquia');
});

test('sobrante por definir puede donarse; enviar menos tablas genera sobrante; sin sobrante no hay gestión', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await s.actualizarEvento({ precioTabla: 20000 });
  const a = await s.crearCompra(datos(2, { montoPagado: 40000, sobranteDestino: '' }), comprobante());
  await verificarTodo(s, a.id, 40000);
  const ea = await s.enviarTablas(a.id, { cantidad: 1 }); // 20.000 de más porque se enviaron menos tablas
  assert.equal(ea.sobranteMonto, 20000);
  assert.equal(ea.sobranteEstado, 'por_definir');
  const don = await s.gestionarSobrante(a.id, { accion: 'donar', nota: 'Autorizó por WhatsApp' });
  assert.equal(don.sobranteEstado, 'donado');
  const b = await s.crearCompra(datos(1, { montoPagado: 20000, sobranteDestino: '' }), comprobante());
  await verificarTodo(s, b.id, 20000);
  const eb = await s.enviarTablas(b.id);
  assert.equal(eb.sobranteEstado, 'ninguno');
  await assert.rejects(s.gestionarSobrante(b.id, { accion: 'donar' }), /no tiene sobrante/);
  const lista = await s.listarSobrantes();
  assert.equal(lista.length, 1);
  assert.equal((await s.reporte('sobrantes')).filas.length, 1);
});

test('los datos del sello salen solo con el token de esa compra', async () => {
  const s = await nuevo();
  await tablas(s, 4);
  const a = await comprar(s, 2, { nombre: 'Dora Gómez' });
  const b = await comprar(s, 1, { nombre: 'Luis Pérez', telefono: '3115556677' });
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  const ea = await s.enviarTablas(a.id);
  const eb = await s.enviarTablas(b.id);
  const da = await s.datosSelloEntrega(ea.tokenEntrega);
  assert.equal(da.nombre, 'Dora Gómez');
  assert.equal(da.telefono, '584121234567');
  assert.equal(da.codigo, ea.codigo);
  assert.deepEqual(da.tablas, ea.tablas);
  const db_ = await s.datosSelloEntrega(eb.tokenEntrega);
  assert.equal(db_.nombre, 'Luis Pérez');
  assert.ok(!db_.tablas.some(t => da.tablas.includes(t)), 'cada token solo ve las tablas de su compra');
  await assert.rejects(s.datosSelloEntrega('1'.repeat(32)), /no válido/);
  await assert.rejects(s.datosSelloEntrega('abc'), /no válido/);
});

// ---------- Teléfonos de otros países ----------
test('el indicativo se agrega según el país elegido y no se duplica', async () => {
  const s = await nuevo();
  await tablas(s, 8);
  const tel = async (telefono, paisCodigo) => (await s.detalleCompra((await comprar(s, 1, { telefono, paisCodigo })).id)).telefono;
  assert.equal(await tel('3001234567', '57'), '573001234567', 'Colombia');
  assert.equal(await tel('0991234567', '593'), '593991234567', 'Ecuador: se quita el 0 inicial');
  assert.equal(await tel('612 345 678', '34'), '34612345678', 'España');
  assert.equal(await tel('(202) 555-0123', '1'), '12025550123', 'Estados Unidos');
  assert.equal(await tel('573001234567', '57'), '573001234567', 'ya traía el indicativo: no se duplica');
  assert.equal(await tel('+34 612 345 678', '57'), '34612345678', 'con + se respeta el indicativo escrito');
  assert.equal(await tel('0034 612 345 678', '57'), '34612345678', 'con 00 también');
  assert.equal(await tel('04121234567', undefined), '584121234567', 'sin país elegido usa el del evento');
  await assert.rejects(comprar(s, 1, { telefono: '12', paisCodigo: '57' }), /no es válido/);
  await assert.rejects(comprar(s, 1, { telefono: '1'.repeat(20), paisCodigo: '57' }), /no es válido/);
});

test('el enlace de WhatsApp usa el número internacional guardado, sin volver a agregar indicativo', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const c = await comprar(s, 1, { telefono: '612 345 678', paisCodigo: '34' });
  await verificarTodo(s, c.id);
  const e = await s.enviarTablas(c.id, { baseUrl: 'https://bingo.test' });
  assert.equal(e.telefono, '34612345678');
  assert.match(await s.enlaceWhatsapp(c.id, 'https://bingo.test'), /^https:\/\/wa\.me\/34612345678\?text=/);
});