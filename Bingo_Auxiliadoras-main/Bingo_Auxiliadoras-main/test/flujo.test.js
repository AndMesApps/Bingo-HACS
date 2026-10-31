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
  assert.equal(g.ganadores[0].ganador.nombre, 'Ana Pérez');
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
  await assert.rejects(s.crearCompra(datos(1, { montoPagado: 15000 }), comprobante()), /valor mínimo/);
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

test('el código de la compra viaja en el mensaje de WhatsApp y en el correo (automático y manual)', async () => {
  const wa = []; const mail = [];
  const whatsapp = {
    normalizarTelefono: t => String(t).replace(/\D/g, ''),
    enviarTablas: async x => { wa.push(x); return { estado: 'enviado' }; },
    enlaceManual: (...a) => `wa:${a[4]}`,
  };
  const correo = { enviarTablas: async x => { mail.push(x); return { estado: 'enviado' }; }, enlaceManual: (...a) => `mailto:${a[4]}` };
  const s = await nuevo({ whatsapp, correo });
  await tablas(s, 3);
  const c = await comprar(s, 1);
  await verificarTodo(s, c.id);
  const e = await s.enviarTablas(c.id, { canales: { whatsapp: true, correo: true } });
  assert.equal(wa[0].codigo, e.codigo);
  assert.equal(mail[0].codigo, e.codigo);
  assert.equal(await s.enlaceWhatsapp(c.id, 'https://x.test'), `wa:${e.codigo}`);
  assert.equal(await s.enlaceCorreo(c.id, 'https://x.test'), `mailto:${e.codigo}`);
});

test('los mensajes reales incluyen el código de compra', () => {
  const { crearWhatsApp } = require('../src/whatsapp');
  const { crearCorreo } = require('../src/correo');
  const w = crearWhatsApp({});
  assert.match(w.mensajeTablas('Ana', ['3', '25'], 'https://x.test/t', 'BNG-4K7P2X'), /Código de su compra: BNG-4K7P2X/);
  assert.doesNotMatch(w.mensajeTablas('Ana', ['3'], null, undefined), /Código de su compra/);
  const m = crearCorreo({}).mensajeTablas('Ana', ['3'], 'https://x.test/t', 'BNG-4K7P2X');
  assert.match(m.texto, /BNG-4K7P2X/);
  assert.match(m.html, /BNG-4K7P2X/);
  assert.match(decodeURIComponent(w.enlaceManual('573001234567', 'Ana', ['3'], null, 'BNG-4K7P2X')), /BNG-4K7P2X/);
});
test('menos que una tabla sin elegir donar se rechaza y dice el mínimo', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  await assert.rejects(
    () => s.crearCompra(datos(1, { montoPagado: 4 }), comprobante()),
    err => err instanceof ErrorApp && /valor mínimo es 10/.test(err.message),
  );
  await assert.rejects(
    () => s.crearCompra(datos(1, { montoPagado: 4, valorInsuficiente: 'completar' }), comprobante()),
    err => err instanceof ErrorApp && /valor mínimo es 10/.test(err.message),
  );
});

test('un pago menor al de una tabla se completa con otro pago en el mismo formulario', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  const r = await s.crearCompra(
    datos(1, { montoPagado: 4, valorInsuficiente: 'completar', pagosExtra: [{ montoPagado: 6, fechaPago: new Date().toISOString().slice(0, 10), referencia: 'R2', comprobantes: comprobante() }] }),
    comprobante(),
  );
  assert.equal(r.donacion, false);
  assert.equal(r.tablasSugeridas, 1);
  const d = await s.detalleCompra(r.id);
  assert.equal(d.pagos.length, 2);
  assert.ok(d.pagos.every(p => p.comprobantes.length === 1));
  await s.verificarPago(d.pagos[0].id, 4);
  await s.verificarPago(d.pagos[1].id, 6);
  const e = await s.enviarTablas(r.id);
  assert.equal(e.tablas.length, 1);
});

test('el pago extra también exige comprobante y fecha válida', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  await assert.rejects(
    () => s.crearCompra(datos(1, { montoPagado: 4, pagosExtra: [{ montoPagado: 6, fechaPago: new Date().toISOString().slice(0, 10), comprobantes: [] }] }), comprobante()),
    err => err instanceof ErrorApp && /pago 2/.test(err.message),
  );
});

test('donar un valor menor al de una tabla: queda como donación sin tablas', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  const r = await s.crearCompra(datos(1, { montoPagado: 4, valorInsuficiente: 'donacion' }), comprobante());
  assert.equal(r.donacion, true);
  let d = await s.detalleCompra(r.id);
  assert.equal(d.cantidad, 0);
  assert.equal(d.estado, 'por_verificar');
  assert.equal((await s.resumen()).dinero.donaciones, 0); // aún sin verificar
  await s.verificarPago(d.pagos[0].id, 4);
  d = await s.detalleCompra(r.id);
  assert.equal(d.estado, 'donacion');
  assert.equal(d.sobranteEstado, 'donado');
  const res = await s.resumen();
  assert.equal(res.dinero.donaciones, 4);
  assert.equal(res.dinero.cobrado, 4);
  assert.equal(res.dinero.ingresos, 4);
  assert.equal(res.tablas.disponibles, 3);
  await assert.rejects(() => s.enviarTablas(r.id), err => err instanceof ErrorApp);
});

// ---------- Varios bingos: reiniciar con histórico ----------
async function venderYEnviar(s, n) {
  const c = await comprar(s, n);
  await verificarTodo(s, c.id);
  return { id: c.id, ...(await s.enviarTablas(c.id)) };
}

test('reiniciar el Bingo: lo vendido pasa al histórico y el nuevo Bingo empieza en cero', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await s.crearGasto({ concepto: 'Premios en especie', monto: 15 });
  const premio = await s.crearPremio({ ronda: 'Ronda 1', premio: 'Canasta', monto: 50 });
  const v = await venderYEnviar(s, 2);
  await s.asignarGanador(premio.id, v.tablas[0]);
  const antes = await s.resumen();
  assert.equal(antes.dinero.cobrado, 20);

  const r = await s.reiniciarBingo({ nombre: 'Bingo 2027', confirmar: true });
  assert.equal(r.nuevo.nombre, 'Bingo 2027');

  // El Bingo nuevo está en cero y con las 5 tablas disponibles.
  const ahora = await s.resumen();
  assert.equal(ahora.dinero.cobrado, 0);
  assert.equal(ahora.dinero.gastos, 0);
  assert.equal(ahora.dinero.balance, 0);
  assert.equal(ahora.tablas.disponibles, 5);
  assert.equal(ahora.tablas.vendidas, 0);
  assert.equal(ahora.evento.nombre, 'Bingo 2027');
  assert.equal(ahora.evento.precioTabla, 0);
  assert.deepEqual(await s.listarCompras(), []);
  assert.deepEqual(await s.listarPremios(), []);
  assert.deepEqual(await s.listarGastos(), []);
  assert.deepEqual(await s.listarSobrantes(), []);
  await assert.rejects(() => s.crearCompra(datos(1), comprobante()), err => err instanceof ErrorApp && err.status === 409);

  // El histórico conserva todo, con su configuración y su resumen.
  const { actual, historico } = await s.listarBingos();
  assert.equal(actual.nombre, 'Bingo 2027');
  assert.equal(historico.length, 1);
  assert.equal(historico[0].nombre, 'Prueba');
  assert.equal(historico[0].config.precioTabla, 10);
  assert.equal(historico[0].resumen.dinero.cobrado, 20);
  assert.equal(historico[0].resumen.tablasVendidas, 2);
  const viejoId = historico[0].id;
  assert.equal((await s.listarCompras({ bingoId: viejoId })).length, 1);
  assert.equal((await s.listarGastos(viejoId)).length, 1);
  const premios = await s.listarPremios(viejoId);
  assert.equal(premios[0].ganadores[0].ganador.nombre, 'Ana Pérez');
  const repTablas = await s.reporte('tablas', viejoId);
  assert.equal(repTablas.filas.length, 2);
  assert.equal((await s.reporte('compras', viejoId)).filas[0][17].split(' ').length, 2);
  assert.equal((await s.reporte('compras')).filas.length, 0);
});

test('tras reiniciar, el enlace del comprador del Bingo anterior sigue mostrando sus tablas', async () => {
  const s = await nuevo();
  await tablas(s, 4);
  const v = await venderYEnviar(s, 2);
  const token = (await s.detalleCompra(v.id)).tokenEntrega;
  await s.reiniciarBingo({ nombre: 'Bingo nuevo', confirmar: true });
  const e = await s.entregaPublica(token);
  assert.equal(e.evento, 'Prueba');
  assert.deepEqual(e.tablas, v.tablas);
  const sello = await s.datosSelloEntrega(token);
  assert.deepEqual(sello.tablas, v.tablas);
});

test('una tabla del Bingo anterior puede venderse de nuevo, pero nunca a dos personas a la vez', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const v1 = await venderYEnviar(s, 2);
  await s.reiniciarBingo({ nombre: 'Bingo 2', confirmar: true });
  await s.actualizarEvento({ precioTabla: 10 });
  const a = await comprar(s, 1);
  const b = await comprar(s, 1);
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  const ea = await s.enviarTablas(a.id);
  const eb = await s.enviarTablas(b.id);
  assert.notEqual(ea.tablas[0], eb.tablas[0]);
  assert.deepEqual([...ea.tablas, ...eb.tablas].sort(), [...v1.tablas].sort());
  assert.equal((await s.resumen()).tablas.disponibles, 0);
  // La compra vieja conserva SUS tablas en el histórico (no las del nuevo comprador).
  assert.deepEqual((await s.detalleCompra(v1.id)).tablas, v1.tablas);
});

test('no se puede reiniciar con compras sin resolver ni sin confirmar', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  await assert.rejects(() => s.reiniciarBingo({ nombre: 'X' }), err => err instanceof ErrorApp);
  const c = await comprar(s, 1);
  await assert.rejects(
    () => s.reiniciarBingo({ nombre: 'X', confirmar: true }),
    err => err instanceof ErrorApp && err.status === 409 && /sin resolver/.test(err.message),
  );
  await verificarTodo(s, c.id);
  await assert.rejects(() => s.reiniciarBingo({ nombre: 'X', confirmar: true }), err => err.status === 409);
  await s.enviarTablas(c.id);
  await assert.rejects(() => s.reiniciarBingo({ nombre: '  ', confirmar: true }), err => err instanceof ErrorApp);
  await s.reiniciarBingo({ nombre: 'X', confirmar: true });
});

test('el control estricto de tablas sigue vigente fuera del reinicio', async () => {
  const s = await nuevo();
  await tablas(s, 2);
  const v = await venderYEnviar(s, 1);
  await assert.rejects(() => s.db.query("UPDATE tablas SET estado = 'disponible', compra_id = NULL WHERE serial = $1", [v.tablas[0]]));
  await s.reiniciarBingo({ nombre: 'Otro', confirmar: true });
  assert.equal((await s.db.query("SELECT current_setting('app.reinicio', true) AS v"))[0].v ?? '', '');
});

test('lo de un Bingo cerrado no se puede modificar y sus compras no reciben tablas', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  const premio = await s.crearPremio({ ronda: 'R1', premio: 'P', monto: 5 });
  await s.crearGasto({ concepto: 'Sonido', monto: 3 });
  const gastoId = (await s.listarGastos())[0].id;
  await s.reiniciarBingo({ nombre: 'Nuevo', confirmar: true });
  await assert.rejects(() => s.pagarPremio(premio.id), err => err.status === 409);
  await assert.rejects(() => s.eliminarGasto(gastoId), err => err.status === 409);
  await assert.rejects(() => s.asignarGanador(premio.id, 'TBL-0000'), err => err.status === 409);
});

test('cambiar el nombre del Bingo activo actualiza el histórico y la página del comprador', async () => {
  const s = await nuevo();
  await s.actualizarEvento({ nombre: 'Gran Bingo' });
  assert.equal((await s.listarBingos()).actual.nombre, 'Gran Bingo');
});

test('una inserción sin bingo_id toma el Bingo activo (compatibilidad con el código anterior)', async () => {
  const s = await nuevo();
  await s.db.query("INSERT INTO gastos (fecha, concepto, categoria, monto, creado_en) VALUES ('2026-10-29', 'x', 'Otros', 1, 'ahora')");
  assert.equal((await s.listarGastos()).length, 1);
});

// ---------- Donar todo sin tablas, con cambio de opinión ----------
test('con derecho a tablas se puede donar todo sin recibirlas', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const r = await s.crearCompra(datos(3, { donarSinTablas: 'si' }), comprobante());
  assert.equal(r.donacion, true);
  assert.equal(r.tablasSugeridas, 3);
  let d = await s.detalleCompra(r.id);
  assert.equal(d.cantidad, 0);
  assert.equal(d.tablasReportadas, 3);
  assert.equal((await s.resumen()).tablas.libresParaVender, 5); // no reserva tablas
  await s.verificarPago(d.pagos[0].id, 30);
  d = await s.detalleCompra(r.id);
  assert.equal(d.estado, 'donacion');
  assert.equal(d.tablasSugeridas, 3);
  const res = await s.resumen();
  assert.equal(res.dinero.donaciones, 30);
  assert.equal(res.tablas.disponibles, 5);
  assert.deepEqual(d.tablas, []);
});

test('sin marcar donar, el sobrante sigue su camino normal', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const r = await s.crearCompra(datos(3, { donarSinTablas: 'no' }), comprobante());
  assert.equal(r.donacion, false);
  assert.equal((await s.detalleCompra(r.id)).cantidad, 3);
});

test('cambio de opinión tras verificar: el administrador convierte la donación y envía las tablas', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const r = await s.crearCompra(datos(3, { donarSinTablas: 'si' }), comprobante());
  await verificarTodo(s, r.id, 30);
  await assert.rejects(() => s.enviarTablas(r.id), err => err instanceof ErrorApp);
  const d = await s.convertirDonacion(r.id);
  assert.equal(d.estado, 'verificada');
  assert.equal(d.cantidad, 3);
  assert.equal(d.total, 30);
  assert.equal(d.sobranteEstado, 'ninguno');
  assert.equal((await s.resumen()).dinero.donaciones, 0); // ya no cuenta como donación
  const e = await s.enviarTablas(r.id);
  assert.equal(e.tablas.length, 3);
  assert.equal(e.estado, 'enviada');
  assert.equal((await s.resumen()).tablas.disponibles, 2);
});

test('convertir con menos tablas deja el resto como sobrante por definir', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const r = await s.crearCompra(datos(3, { donarSinTablas: 'si' }), comprobante());
  await verificarTodo(s, r.id, 30);
  await s.convertirDonacion(r.id, { cantidad: 2 });
  const e = await s.enviarTablas(r.id, { cantidad: 2 });
  assert.equal(e.tablas.length, 2);
  assert.equal(e.sobranteMonto, 10);
  assert.equal(e.sobranteEstado, 'por_definir');
});

test('cambio de opinión antes de verificar: pasa a compra normal por verificar', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const r = await s.crearCompra(datos(2, { donarSinTablas: 'si' }), comprobante());
  let d = await s.convertirDonacion(r.id);
  assert.equal(d.estado, 'por_verificar');
  assert.equal(d.cantidad, 2);
  await s.verificarPago(d.pagos[0].id, 20);
  d = await s.detalleCompra(r.id);
  assert.equal(d.estado, 'verificada');
  assert.equal((await s.enviarTablas(r.id)).tablas.length, 2);
});

test('convertir una donación: no más tablas de las que paga, ni de un Bingo cerrado, ni de una compra normal', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const normal = await comprar(s, 1);
  await assert.rejects(() => s.convertirDonacion(normal.id), err => err.status === 409);
  const chica = await s.crearCompra(datos(1, { montoPagado: 4, valorInsuficiente: 'donacion' }), comprobante());
  await verificarTodo(s, chica.id, 4);
  await assert.rejects(() => s.convertirDonacion(chica.id), err => err.status === 409 && /no alcanza/.test(err.message));
  const r = await s.crearCompra(datos(2, { donarSinTablas: 'si' }), comprobante());
  await verificarTodo(s, r.id, 20);
  await assert.rejects(() => s.convertirDonacion(r.id, { cantidad: 3 }), err => err.status === 409);
  await verificarTodo(s, normal.id);
  await s.enviarTablas(normal.id);
  await s.reiniciarBingo({ nombre: 'Otro', confirmar: true });
  await assert.rejects(() => s.convertirDonacion(r.id), err => err.status === 409 && /cerrado/.test(err.message));
});

test('la lista de compras trae forma de pago, fecha del pago y valor reportado', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  const hoy = new Date().toISOString().slice(0, 10);
  await s.crearCompra(datos(1, { metodo: 'Efectivo', fechaPago: hoy }), []);
  await s.crearCompra(datos(1), comprobante());
  const filas = await s.listarCompras();
  const ef = filas.find(c => c.metodos === 'Efectivo');
  const tr = filas.find(c => c.metodos === 'Consignación');
  assert.ok(ef && tr);
  assert.equal(ef.reportado, 10);
  assert.equal(tr.fechaPago, hoy);
});

test('el listado de tablas dice a quién se vendió cada una y va en orden numérico', async () => {
  const s = await nuevo();
  await s.importarTablas('1\n2\n10\n11');
  const c = await comprar(s, 2);
  await verificarTodo(s, c.id);
  const e = await s.enviarTablas(c.id);
  const lista = await s.listarTablas();
  assert.deepEqual(lista.map(t => t.serial), ['1', '2', '10', '11']);
  const vendidas = lista.filter(t => t.estado === 'vendida');
  assert.equal(vendidas.length, 2);
  assert.deepEqual(vendidas.map(t => t.serial).sort(), [...e.tablas].sort());
  for (const t of vendidas) {
    assert.equal(t.compraId, c.id);
    assert.equal(t.compraNombre, 'Ana Pérez');
    assert.ok(t.compraTelefono);
  }
  assert.equal(lista.find(t => t.estado === 'disponible').compraNombre, null);
});

// ---------- Invitación configurable: imagen y texto por Bingo ----------
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('la invitación empieza con la pieza predeterminada y sin texto propio', async () => {
  const s = await nuevo();
  const e = await s.evento();
  assert.equal(e.pieza, 'predeterminada');
  assert.equal(e.textoInvitacion, '');
  assert.equal((await s.piezaInvitacion()).origen, 'predeterminada');
});

test('se puede cargar la imagen y el texto de la invitación, y quitar la imagen', async () => {
  const s = await nuevo();
  const e = await s.actualizarEvento({ piezaInvitacion: PNG_1X1, textoInvitacion: '  ¡Bingo! Premio mayor $400.000  ' });
  assert.equal(e.pieza, 'propia');
  assert.equal(e.textoInvitacion, '¡Bingo! Premio mayor $400.000');
  const p = await s.piezaInvitacion();
  assert.equal(p.origen, 'propia');
  assert.equal(p.tipo, 'image/png');
  assert.ok(Buffer.isBuffer(p.buffer) && p.buffer.length > 20);
  // guardar otra cosa no borra la imagen ni el texto
  const e2 = await s.actualizarEvento({ precioTabla: 12 });
  assert.equal(e2.pieza, 'propia');
  assert.equal(e2.textoInvitacion, '¡Bingo! Premio mayor $400.000');
  // quitar la imagen
  assert.equal((await s.actualizarEvento({ piezaInvitacion: '' })).pieza, 'ninguna');
  assert.equal((await s.piezaInvitacion()).origen, 'ninguna');
});

test('la imagen y el texto de la invitación se validan', async () => {
  const s = await nuevo();
  await assert.rejects(() => s.actualizarEvento({ piezaInvitacion: 'data:text/html;base64,AAAA' }), err => err instanceof ErrorApp);
  await assert.rejects(() => s.actualizarEvento({ piezaInvitacion: 'no es una imagen' }), err => err instanceof ErrorApp);
  await assert.rejects(() => s.actualizarEvento({ textoInvitacion: 'x'.repeat(1501) }), err => err instanceof ErrorApp);
  assert.equal((await s.evento()).pieza, 'predeterminada');
});

test('al reiniciar el Bingo, la invitación del nuevo empieza sin imagen ni texto propios', async () => {
  const s = await nuevo();
  await s.actualizarEvento({ piezaInvitacion: PNG_1X1, textoInvitacion: 'Invitación del bingo 1' });
  await tablas(s, 2);
  await s.reiniciarBingo({ nombre: 'Bingo 2', confirmar: true });
  const e = await s.evento();
  assert.equal(e.pieza, 'ninguna');
  assert.equal(e.textoInvitacion, '');
  // la configuración guardada del Bingo cerrado no arrastra la imagen
  const { historico } = await s.listarBingos();
  assert.equal(historico[0].config.textoInvitacion, 'Invitación del bingo 1');
  assert.equal(JSON.stringify(historico[0].config).includes('base64'), false);
});

// ---------- Sorteo en vivo ----------
const { evaluarTabla } = require('../src/figuras');
const FILA1 = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 0, 48, 63, 4, 19, 33, 49, 64, 5, 20, 34, 50, 65];

test('figuras: línea, esquinas, equis, marco y cartón lleno', () => {
  assert.equal(evaluarTabla('linea', FILA1, [1, 16, 31, 46, 61]).cumple, true);
  assert.equal(evaluarTabla('linea', FILA1, [1, 16, 31, 46]).faltan, 1);
  assert.equal(evaluarTabla('linea', FILA1, [3, 18, 48, 63]).cumple, true, 'la fila del centro usa la casilla libre');
  assert.equal(evaluarTabla('linea', FILA1, [1, 2, 3, 4, 5]).cumple, true, 'columna');
  assert.equal(evaluarTabla('cuatro_esquinas', FILA1, [1, 61, 5, 65]).cumple, true);
  assert.equal(evaluarTabla('equis', FILA1, [1, 17, 49, 65, 61, 47, 19, 5]).cumple, true);
  assert.equal(evaluarTabla('marco', FILA1, FILA1.filter(n => n && ![17, 32, 47, 18, 48, 19, 33, 49].includes(n))).cumple, true);
  assert.equal(evaluarTabla('carton_lleno', FILA1, FILA1.slice(0, 24)).cumple, false);
  assert.equal(evaluarTabla('carton_lleno', FILA1, FILA1).cumple, true);
});

async function ronda(s, figura) {
  await tablas(s, 3);
  const c = await comprar(s, 1);
  await verificarTodo(s, c.id);
  const e = await s.enviarTablas(c.id);
  const serial = e.tablas[0];
  await s.db.query('UPDATE tablas SET numeros = $1 WHERE serial = $2', [JSON.stringify(FILA1), serial]);
  const p = await s.crearPremio({ ronda: 'Línea', premio: 'Canasta', monto: 5, figura });
  return { p, serial, compra: c };
}

test('sorteo: cantar balotas, verificar tabla y asignar ganador cierra la ronda', async () => {
  const s = await nuevo();
  const { p, serial } = await ronda(s, 'linea');
  await assert.rejects(() => s.cantarBalota(p.id, 1), /no está en juego/);
  await s.iniciarRonda(p.id);
  for (const n of [1, 16, 31, 46]) await s.cantarBalota(p.id, n);
  await assert.rejects(() => s.cantarBalota(p.id, 16), /ya fue cantada/);
  await assert.rejects(() => s.cantarBalota(p.id, 76), /1 al 75/);
  let v = await s.verificarTabla(p.id, serial);
  assert.equal(v.cumple, false);
  assert.equal(v.faltan, 1);
  await assert.rejects(() => s.asignarGanador(p.id, serial), /no cumple/);
  await s.cantarBalota(p.id, 61);
  v = await s.verificarTabla(p.id, serial);
  assert.equal(v.cumple, true);
  assert.equal(v.comprador.nombre, 'Ana Pérez');
  const g = await s.asignarGanador(p.id, serial);
  assert.equal(g.rondaEstado, 'cerrada');
  assert.equal((await s.estadoSorteo()).ronda, null);
});

test('sorteo: deshacer balota, una sola ronda en juego, tabla no vendida no gana', async () => {
  const s = await nuevo();
  const { p } = await ronda(s, 'linea');
  const p2 = await s.crearPremio({ ronda: 'Otra', premio: 'X', monto: 1 });
  await s.iniciarRonda(p.id);
  await assert.rejects(() => s.iniciarRonda(p2.id), /sigue en juego/);
  await s.cantarBalota(p.id, 7);
  assert.deepEqual((await s.deshacerBalota(p.id, 7)).balotas, []);
  const libre = (await s.listarTablas()).find(t => t.estado === 'disponible').serial;
  const v = await s.verificarTabla(p.id, libre);
  assert.equal(v.cumple, false);
  assert.match(v.motivo, /no está vendida/);
  await s.pausarRonda(p.id);
  await s.iniciarRonda(p2.id);
});

test('premio: la entrega registra quién recibió', async () => {
  const s = await nuevo();
  const { p, serial } = await ronda(s, 'carton_lleno');
  await s.asignarGanador(p.id, serial);
  const e = await s.pagarPremio(p.id, { recibidoPor: 'Ana Pérez CC 123', nota: 'Entregado en el evento' });
  assert.equal(e.pagado, true);
  assert.equal(e.ganadores[0].recibidoPor, 'Ana Pérez CC 123');
});

test('envío automático: al verificar el pago se asignan y envían las tablas pedidas', async () => {
  const enviados = [];
  const correo = { configurado: true, enviarTablas: async x => { enviados.push(['correo', x.correo]); return { estado: 'enviado' }; }, enlaceManual: () => '' };
  const wa = { configurado: true, enviarTablas: async x => { enviados.push(['whatsapp', x.telefono]); return { estado: 'enviado' }; }, enlaceManual: () => '', normalizarTelefono: t => t };
  const s = await nuevo({ whatsapp: wa, correo });
  await tablas(s, 5);
  await s.actualizarEvento({ envioAutomatico: true });
  const c = await comprar(s, 2);
  const d = await verificarTodo(s, c.id);
  assert.equal(d.estado, 'enviada');
  assert.equal(d.tablas.length, 2);
  assert.equal(d.whatsappEstado, 'enviado');
  assert.equal(d.correoEstado, 'enviado');
  assert.deepEqual(enviados.map(e => e[0]).sort(), ['correo', 'whatsapp']);
});

test('envío automático apagado: el pago verificado queda listo para enviar a mano', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  const c = await comprar(s, 1);
  assert.equal((await verificarTodo(s, c.id)).estado, 'verificada');
});

test('envío automático: sin correo solo WhatsApp; con pago insuficiente no envía', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  await s.actualizarEvento({ envioAutomatico: true });
  const a = await comprar(s, 1, { correo: '' });
  const da = await verificarTodo(s, a.id);
  assert.equal(da.estado, 'enviada');
  assert.equal(da.correoEstado, 'no_enviado');
  const b = await comprar(s, 3);
  const db_ = await s.detalleCompra(b.id);
  const dbb = await s.verificarPago(db_.pagos[0].id, 20); // cubre 2 de las 3 que pidió
  assert.equal(dbb.estado, 'verificada');
  assert.equal(dbb.tablas.length, 0);
});

// ---------- Informes ----------
test('informes: estado de resultados, caja, ventas por referido/ciudad, gastos y premios cuadran', async () => {
  const s = await nuevo();
  await tablas(s, 10);
  const hoy = new Date().toISOString().slice(0, 10);
  const a = await comprar(s, 2, { referidoPor: 'Hna. María', ciudad: 'Medellín' });
  const b = await comprar(s, 3, { referidoPor: 'Hna. María', ciudad: 'Cali', metodo: 'Efectivo', comprobantes: undefined });
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  await s.enviarTablas(a.id);
  await s.enviarTablas(b.id);
  await s.crearGasto({ fecha: hoy, concepto: 'Impresión', categoria: 'Impresión', monto: 8 });
  const premio = await s.crearPremio({ ronda: 'R1', premio: 'Canasta', monto: 12 });
  const serial = (await s.detalleCompra(a.id)).tablas[0];
  await s.asignarGanador(premio.id, serial);
  await s.pagarPremio(premio.id, { recibidoPor: 'Ana' });

  const i = await s.informes({});
  assert.equal(i.resultados.cobrado, 50);
  assert.equal(i.resultados.ingresos, 50);
  assert.equal(i.resultados.premiosPagados, 12);
  assert.equal(i.resultados.gastos, 8);
  assert.equal(i.resultados.excedente, 30);
  assert.equal(i.caja.dias.reduce((t, d) => t + d.total, 0), 50);
  const ref = i.porReferido.find(r => r.clave === 'Hna. María');
  assert.deepEqual([ref.compras, ref.tablas, ref.monto], [2, 5, 50]);
  assert.equal(i.porCiudad.length, 2);
  assert.equal(i.gastosPorCategoria[0].monto, 8);
  assert.equal(i.premios[0].estado, 'entregado');
  assert.equal(i.tablas.vendidas, 5);

  // Rango sin movimientos: todo en cero. Fechas inválidas se rechazan.
  const vacio = await s.informes({ desde: '2000-01-01', hasta: '2000-01-31' });
  assert.equal(vacio.resultados.cobrado, 0);
  assert.equal(vacio.caja.dias.length, 0);
  await assert.rejects(() => s.informes({ desde: 'ayer' }), /no es válida/);
  await assert.rejects(() => s.informes({ desde: '2026-02-02', hasta: '2026-01-01' }), /posterior/);
});

// ---------- Excel ----------
test('Excel: los reportes salen en un libro con hojas, encabezados, totales y formatos', async () => {
  const ExcelJS = require('exceljs');
  const { libroDeReportes, libroDeInformes, TITULOS_REPORTE } = require('../src/excel');
  const s = await nuevo();
  await tablas(s, 6);
  const a = await comprar(s, 2, { referidoPor: 'Hna. María', ciudad: 'Medellín' });
  const b = await comprar(s, 1, { ciudad: 'Cali' });
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  await s.enviarTablas(a.id);
  await s.enviarTablas(b.id);
  await s.crearGasto({ fecha: new Date().toISOString().slice(0, 10), concepto: 'Impresión', categoria: 'Impresión', monto: 8 });
  await s.crearPremio({ ronda: 'R1', premio: 'Canasta', monto: 12, figura: 'linea' });

  const items = [];
  for (const clave of Object.keys(TITULOS_REPORTE)) items.push({ clave, data: await s.reporte(clave) });
  const buf = await libroDeReportes(items);
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'es un .xlsx (zip)');

  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buf);
  assert.deepEqual(libro.worksheets.map(w => w.name), Object.values(TITULOS_REPORTE));
  const compras = libro.getWorksheet('Compras');
  assert.match(String(compras.getCell('B1').value), /Prueba — Compras/);
  assert.equal(compras.getCell('A4').value, 'Código');
  assert.equal(compras.getCell('K4').value, 'Total');
  assert.equal(compras.getCell('N5').value, 'Enviada', 'el estado sale en español');
  assert.equal(compras.getCell('K5').numFmt.includes('#,##0'), true);
  const totalFila = compras.getRow(7); // 2 compras: filas 5 y 6, total en la 7
  assert.equal(totalFila.getCell(1).value, 'TOTAL');
  assert.equal(totalFila.getCell(11).value.result, 30, 'suma de totales: 20 + 10');
  assert.equal(compras.views[0].ySplit, 4, 'encabezado congelado');
  assert.ok(compras.autoFilter, 'tiene filtros');
  assert.equal(libro.getWorksheet('Gastos').getCell('D5').value, 8);
  assert.equal(libro.getWorksheet('Premios').getCell('E4').value, 'Tabla ganadora');

  const inf = new ExcelJS.Workbook();
  await inf.xlsx.load(await libroDeInformes(await s.informes({})));
  assert.deepEqual(inf.worksheets.map(w => w.name), ['Estado de resultados', 'Caja por día', 'Pagos', 'Ventas por día', 'Por referido', 'Por ciudad', 'Gastos', 'Premios', 'Tablas y entregas']);
  assert.equal(inf.getWorksheet('Estado de resultados').getCell('B8').value, 30, 'ingresos = cobrado');

  // Un reporte vacío no rompe el libro.
  const vacio = new ExcelJS.Workbook();
  const s2 = await nuevo();
  await vacio.xlsx.load(await libroDeReportes([{ clave: 'deudas', data: await s2.reporte('deudas') }]));
  assert.match(String(vacio.getWorksheet('Deudas').getCell('A5').value), /Todavía no hay datos/);
});

// ---------- Empates y unicidad de tablas ----------
const TABLA_A = FILA1; // fila superior: 1, 16, 31, 46, 61
const TABLA_B = [1, 16, 32, 47, 62, 2, 17, 33, 48, 63, 3, 18, 0, 49, 64, 4, 19, 34, 50, 65, 5, 20, 35, 51, 66]; // columna B: 1-5

async function dosCompradores() {
  const s = await nuevo();
  await tablas(s, 6);
  const a = await comprar(s, 1);
  const b = await comprar(s, 1, { nombre: 'Luis Gómez' });
  for (const c of [a, b]) { await verificarTodo(s, c.id); await s.enviarTablas(c.id); }
  const sa = (await s.detalleCompra(a.id)).tablas[0];
  const sb = (await s.detalleCompra(b.id)).tablas[0];
  await s.db.query('UPDATE tablas SET numeros = $1 WHERE serial = $2', [JSON.stringify(TABLA_A), sa]);
  await s.db.query('UPDATE tablas SET numeros = $1 WHERE serial = $2', [JSON.stringify(TABLA_B), sb]);
  return { s, sa, sb };
}

test('empate: dos tablas completan la figura con la misma balota y se reparten el premio', async () => {
  const { s, sa, sb } = await dosCompradores();
  const p = await s.crearPremio({ ronda: 'Línea', premio: 'Canasta', monto: 100, figura: 'linea' });
  await s.iniciarRonda(p.id);
  for (const n of [16, 31, 46, 61, 2, 3, 4, 5]) await s.cantarBalota(p.id, n);
  await s.cantarBalota(p.id, 1); // la última balota completa las dos tablas

  const va = await s.verificarTabla(p.id, sa);
  assert.equal(va.cumple, true);
  assert.equal(va.aTiempo, true);
  const a = await s.asignarGanador(p.id, sa, { cerrar: false });
  assert.equal(a.estado, 'en revisión');
  assert.equal(a.rondaEstado, 'en_juego', 'la ronda sigue abierta para registrar el empate');

  const vb = await s.verificarTabla(p.id, sb);
  assert.equal(vb.cumple, true);
  assert.match(vb.motivo, /empate/);
  assert.deepEqual(vb.ganadoras, [sa]);
  await assert.rejects(() => s.asignarGanador(p.id, sa, { cerrar: false }), /ya está registrada/);
  await s.asignarGanador(p.id, sb, { cerrar: false });
  await assert.rejects(() => s.pagarPremio(p.id), /2 tablas ganadoras/);
  await assert.rejects(() => s.entregarPremio(a.ganadores[0].id, {}), /Cierra la ronda/);

  const c = await s.cerrarRonda(p.id);
  assert.equal(c.rondaEstado, 'cerrada');
  assert.equal(c.empate, true);
  assert.equal(c.estado, 'por entregar');
  assert.deepEqual(c.ganadores.map(g => g.monto), [50, 50], 'el premio se reparte en partes iguales');
  assert.equal((await s.estadoSorteo()).ronda, null);

  const [g1, g2] = c.ganadores;
  const e1 = await s.entregarPremio(g1.id, { recibidoPor: 'Ana Pérez CC 1' });
  assert.equal(e1.estado, 'entrega parcial');
  await assert.rejects(() => s.entregarPremio(g1.id, {}), /ya fue entregado/);
  await assert.rejects(() => s.quitarGanadora(g1.id), /ya se le entregó/);
  await assert.rejects(() => s.asignarGanador(p.id, sb), /Ya se entregó parte/);
  assert.equal((await s.resumen()).dinero.premiosPagados, 50);
  const e2 = await s.entregarPremio(g2.id, { recibidoPor: 'Luis Gómez CC 2', nota: 'En el evento' });
  assert.equal(e2.estado, 'entregado');
  assert.equal((await s.resumen()).dinero.premiosPagados, 100);
});

test('empate: el reparto con centavos suma exactamente el premio y quitar una ganadora lo recalcula', async () => {
  const s = await nuevo();
  await tablas(s, 8);
  const seriales = [];
  for (let i = 0; i < 3; i++) {
    const c = await comprar(s, 1, { nombre: `Persona ${i}` });
    await verificarTodo(s, c.id);
    seriales.push((await s.enviarTablas(c.id)).tablas[0]);
  }
  const p = await s.crearPremio({ ronda: 'R', premio: 'P', monto: 100 });
  for (const sr of seriales) await s.asignarGanador(p.id, sr); // manual: la ronda no está en juego
  let d = (await s.listarPremios())[0];
  assert.deepEqual(d.ganadores.map(g => g.monto), [33.34, 33.33, 33.33]);
  assert.equal(d.ganadores.reduce((t, g) => t + g.monto, 0).toFixed(2), '100.00');
  d = await s.quitarGanadora(d.ganadores[2].id);
  assert.deepEqual(d.ganadores.map(g => g.monto), [50, 50]);
  d = await s.quitarGanador(p.id);
  assert.equal(d.ganadores.length, 0);
  assert.equal(d.rondaEstado, 'pendiente', 'sin ganadoras la ronda vuelve a quedar disponible');
});

test('sorteo: avisa si una tabla ya estaba completa antes de la última balota', async () => {
  const { s, sa } = await dosCompradores();
  const p = await s.crearPremio({ ronda: 'Línea', premio: 'Canasta', monto: 10, figura: 'linea' });
  await s.iniciarRonda(p.id);
  for (const n of [1, 16, 31, 46, 61, 40]) await s.cantarBalota(p.id, n); // la tabla A se completó con la 61; después salió el 40
  const v = await s.verificarTabla(p.id, sa);
  assert.equal(v.cumple, true);
  assert.equal(v.aTiempo, false);
  assert.match(v.motivo, /antes de la última balota/);
});

test('garantía: la base de datos impide dos tablas con los mismos números (misma distribución o mismo conjunto)', async () => {
  const s = await nuevo();
  await tablas(s, 5);
  const poner = (serial, numeros) => s.db.query('UPDATE tablas SET numeros = $1 WHERE serial = $2', [JSON.stringify(numeros), serial]);
  const lista = (await s.listarTablas()).map(t => t.serial);
  await poner(lista[0], TABLA_A);
  await poner(lista[0], TABLA_A); // la misma tabla puede repetir sus propios números
  await assert.rejects(() => poner(lista[1], TABLA_A), /duplicate key|unique/i, 'misma distribución');
  await assert.rejects(() => poner(lista[1], [...TABLA_A].reverse()), /duplicate key|unique/i, 'mismos números en otra disposición');
  await assert.rejects(() => poner(lista[1], TABLA_A.slice(0, 24)), /25 números/);
  await assert.rejects(() => poner(lista[1], [...TABLA_A.slice(0, 24), 99]), /entre 0 y 75/);
  await poner(lista[1], TABLA_B); // una tabla distinta sí se acepta
  assert.equal((await s.db.query('SELECT COUNT(*)::int AS n FROM tablas WHERE numeros_clave IS NOT NULL'))[0].n, 2);
});

test('garantía: las 500 tablas de los archivos de números son todas distintas', () => {
  const dir = path.join(__dirname, '..', 'scripts', 'tablas-bingo');
  const todas = { ...JSON.parse(fs.readFileSync(path.join(dir, 'numeros-1-400.json'), 'utf8')), ...JSON.parse(fs.readFileSync(path.join(dir, 'numeros-401-500.json'), 'utf8')) };
  assert.equal(Object.keys(todas).length, 500);
  const distribuciones = new Set();
  const conjuntos = new Set();
  for (const matriz of Object.values(todas)) {
    const plano = matriz.flat();
    assert.equal(plano.length, 25);
    distribuciones.add(plano.join(','));
    conjuntos.add([...plano].sort((x, y) => x - y).join(','));
  }
  assert.equal(distribuciones.size, 500, 'no hay dos tablas con la misma distribución');
  assert.equal(conjuntos.size, 500, 'no hay dos tablas con los mismos números en otra disposición');
});

// ---------- WhatsApp: plantilla e idioma ----------
test('WhatsApp: envía la plantilla con nombre y detalle, en el idioma configurado', async () => {
  const llamadas = [];
  const fetchFn = async (url, init) => { llamadas.push({ url, cuerpo: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true }; };
  const wa = crearWhatsApp({ token: 'T', phoneId: '123', plantilla: 'entrega_tablas_bingo', idioma: 'es_CO', fetchFn });
  const r = await wa.enviarTablas({ telefono: '573001234567', nombre: 'Ana', seriales: ['12', '87'], enlace: 'https://x.test/tablas.html?t=abc', codigo: 'BNG-1' });
  assert.equal(r.estado, 'enviado');
  const c = llamadas[0];
  assert.match(c.url, /\/123\/messages$/);
  assert.equal(c.auth, 'Bearer T');
  assert.equal(c.cuerpo.type, 'template');
  assert.equal(c.cuerpo.template.name, 'entrega_tablas_bingo');
  assert.equal(c.cuerpo.template.language.code, 'es_CO');
  const [nombre, detalle] = c.cuerpo.template.components[0].parameters.map(p => p.text);
  assert.equal(nombre, 'Ana');
  assert.equal(detalle, '12, 87 · https://x.test/tablas.html?t=abc · Código BNG-1');
  assert.ok(!/\n/.test(detalle), 'las plantillas de Meta no admiten saltos de línea en las variables');
  // Sin credenciales no envía: devuelve el enlace manual.
  const manual = await crearWhatsApp({}).enviarTablas({ telefono: '573001234567', nombre: 'Ana', seriales: ['1'], enlace: null, codigo: 'BNG-1' });
  assert.equal(manual.estado, 'manual');
});

test('WhatsApp manual: el resumen cuenta las compras a las que falta enviarles el WhatsApp desde el celular', async () => {
  const s = await nuevo(); // sin WhatsApp conectado: el envío queda "manual"
  await tablas(s, 4);
  const a = await comprar(s, 1);
  const b = await comprar(s, 1, { nombre: 'Luis Gómez' });
  await verificarTodo(s, a.id);
  await verificarTodo(s, b.id);
  await s.enviarTablas(a.id); // por defecto solo WhatsApp
  await s.enviarTablas(b.id, { canales: { correo: true } }); // solo correo (sin Resend queda manual, pero no es WhatsApp)
  assert.equal((await s.detalleCompra(a.id)).whatsappEstado, 'manual');
  assert.equal((await s.resumen()).compras.whatsappPendientes, 1);
  await s.marcarEnviadoManual(a.id, 'whatsapp');
  assert.equal((await s.resumen()).compras.whatsappPendientes, 0);
});

// ---------- Mensaje con las tablas ----------
test('mensaje: saludo por hora, nombre, fecha, cantidad, números, enlaces y dónde está el número de la tabla', async () => {
  const { textoWhatsApp, mensajeCorreo, fechaLarga, saludoDe, primerNombre } = require('../src/mensajes');
  assert.equal(fechaLarga('2026-05-24'), 'domingo 24 de mayo del 2026');
  assert.equal(fechaLarga(''), '');
  assert.equal(fechaLarga('2026-02-31'), '');
  assert.equal(saludoDe(new Date('2026-05-24T14:00:00Z')), 'Buenos días'); // 9:00 en Colombia
  assert.equal(saludoDe(new Date('2026-05-24T20:00:00Z')), 'Buenas tardes'); // 15:00
  assert.equal(saludoDe(new Date('2026-05-25T01:30:00Z')), 'Buenas noches'); // 20:30
  assert.equal(primerNombre('TERESITA PÉREZ'), 'Teresita');

  const datos = { nombre: 'TERESITA PÉREZ', seriales: ['12', '87'], enlace: 'https://x.test/tablas.html?t=abc', codigo: 'BNG-AB12CD',
    fechaSorteo: '2026-05-24', enlaceConexion: 'https://meet.google.com/abc-defg-hij', ahora: new Date('2026-05-24T20:00:00Z') };
  const t = textoWhatsApp(datos);
  assert.match(t, /^Buenas tardes Teresita, esperando estén super bien\./);
  assert.match(t, /\*¡Tus tablas de bingo!\*/);
  assert.match(t, /Bingo de las Hermanas Auxiliadoras de Cristo Sacerdote, a realizarse el domingo 24 de mayo del 2026\./);
  assert.match(t, /enumeradas en la parte superior, en el óvalo dorado que dice «TABLA N° …»/);
  assert.match(t, /va marcada con su nombre: en la franja azul de abajo/);
  assert.match(t, /Anexo enlace para conexión: https:\/\/meet\.google\.com\/abc-defg-hij\nNo es requerido/);
  assert.match(t, /Anexo: 2 tablas \(N° 12 y 87\)\./);
  assert.match(t, /Descárguelas aquí: https:\/\/x\.test\/tablas\.html\?t=abc/);
  assert.match(t, /Código de su compra: BNG-AB12CD/);
  assert.match(t, /Gracias, feliz día\.$/);
  assert.doesNotMatch(t, /Miryam/);

  // Sin fecha ni enlace de conexión, y con una sola tabla.
  const t2 = textoWhatsApp({ nombre: 'ana', seriales: ['5'], ahora: new Date('2026-05-24T14:00:00Z') });
  assert.match(t2, /Buenos días Ana,/);
  assert.doesNotMatch(t2, /a realizarse/);
  assert.match(t2, /Anexo: 1 tabla \(N° 5\)\./);
  assert.match(t2, /El enlace para conexión se lo enviaremos antes del bingo\./);

  const c = mensajeCorreo({ ...datos, nombre: '<b>Ana</b>' });
  assert.equal(c.asunto, '¡Tus tablas de bingo!');
  assert.match(c.html, /<a href="https:\/\/meet\.google\.com\/abc-defg-hij">/);
  assert.match(c.html, /&lt;b&gt;ana&lt;\/b&gt;/, 'el nombre se escapa en el HTML');
  assert.match(c.texto, /Anexo: 2 tablas/);
});

test('mensaje: el enlace de conexión se configura, se valida y llega al WhatsApp manual y al correo', async () => {
  const s = await nuevo();
  await tablas(s, 3);
  await assert.rejects(() => s.actualizarEvento({ enlaceConexion: 'meet.google.com/abc' }), /http/);
  await s.actualizarEvento({ fechaSorteo: '2026-05-24', enlaceConexion: 'https://meet.google.com/abc-defg-hij' });
  assert.equal((await s.evento()).enlaceConexion, 'https://meet.google.com/abc-defg-hij');
  const c = await comprar(s, 1, { nombre: 'Teresita Pérez' });
  await verificarTodo(s, c.id);
  await s.enviarTablas(c.id, { canales: { whatsapp: true, correo: true }, baseUrl: 'https://bingo.test' });
  const wa = decodeURIComponent((await s.enlaceWhatsapp(c.id, 'https://bingo.test')).split('?text=')[1]);
  assert.match(wa, /Teresita,/);
  assert.match(wa, /domingo 24 de mayo del 2026/);
  assert.match(wa, /Anexo enlace para conexión: https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(wa, /https:\/\/bingo\.test\/tablas\.html\?t=/);
  const mail = decodeURIComponent((await s.enlaceCorreo(c.id, 'https://bingo.test')).split('body=')[1]);
  assert.match(mail, /meet\.google\.com\/abc-defg-hij/);
  // Al reiniciar el Bingo el enlace de la reunión se borra.
  await s.reiniciarBingo({ nombre: 'Siguiente', confirmar: true });
  assert.equal((await s.evento()).enlaceConexion, '');
});

test('conexión: de la invitación completa de Zoom queda solo enlace, ID y hora, y así llega al mensaje', async () => {
  const { compactarInvitacion, textoWhatsApp } = require('../src/mensajes');
  const invitacion = `Lina Álvarez le está invitando a una reunión de Zoom programada.

Tema: Bingo Virtual HACS
Hora: 22 nov 2026 03:30 p. m. Bogotá

Únase a la reunión de Zoom
https://us06web.zoom.us/j/83195604774

Unirse y tomar notas
https://us06web.zoom.us/j/83195604774?mynotes=on

Enlace al chat de la reunión
https://us06web.zoom.us/launch/jc/83195604774

ID de reunión: 831 9560 4774

Móvil con un toque
+13017158592,,83195604774# Estados Unidos (Washington DC)

Unirse mediante SIP
* 83195604774@zoomcrc.com

Instrucciones para unirse
https://us06web.zoom.us/meetings/83195604774/invitations?signature=Rg-hdtv7IdOzHM1kWa1-WqHHbWd0yMg_HSaiP9_wCOQ`;
  const compacto = compactarInvitacion(invitacion);
  assert.equal(compacto, 'https://us06web.zoom.us/j/83195604774\nID de reunión: 831 9560 4774\nHora: 3:30 p. m. (hora de Bogotá)');
  assert.equal(compactarInvitacion('sin enlaces aquí'), '');
  assert.equal(compactarInvitacion('Join: https://meet.google.com/abc-defg-hij.'), 'https://meet.google.com/abc-defg-hij');

  const t = textoWhatsApp({ nombre: 'Ana', seriales: ['1'], fechaSorteo: '2026-11-22', enlaceConexion: compacto, ahora: new Date('2026-11-22T20:00:00Z') });
  assert.match(t, /a realizarse el domingo 22 de noviembre del 2026/);
  assert.match(t, /Anexo enlace para conexión:\nhttps:\/\/us06web\.zoom\.us\/j\/83195604774\nID de reunión: 831 9560 4774\nHora: 3:30 p\. m\. \(hora de Bogotá\)\nNo es requerido/);
  for (const sobra of ['mynotes', 'zoomcrc', 'signature', 'Móvil con un toque', 'launch']) assert.ok(!t.includes(sobra), `no debe traer «${sobra}»`);

  const s = await nuevo();
  await s.actualizarEvento({ enlaceConexion: compacto });
  assert.equal((await s.evento()).enlaceConexion, compacto);
  await assert.rejects(() => s.actualizarEvento({ enlaceConexion: invitacion }), /demasiado largos/);
});

test('texto editable: etiquetas, líneas sin datos, validación y vista previa', async () => {
  const { renderizar, valoresDelMensaje, validarPlantilla, PLANTILLA_ORIGINAL, textoWhatsApp, mensajeCorreo, nombreCompleto } = require('../src/mensajes');
  const datos = { nombre: 'TERESITA PÉREZ', seriales: ['12', '87'], enlace: 'https://x.test/t?t=1', codigo: 'BNG-1', fechaSorteo: '2026-11-22', ahora: new Date('2026-11-22T20:00:00Z') };
  assert.equal(nombreCompleto('TERESITA PÉREZ'), 'Teresita Pérez');

  // Un texto propio con etiquetas.
  const propio = 'Hola {nombre_completo}: tienes {cantidad} ({numeros}). Fecha: {fecha}.\n{enlace}';
  assert.equal(textoWhatsApp({ ...datos, plantilla: propio }), 'Hola Teresita Pérez: tienes 2 tablas (12 y 87). Fecha: domingo 22 de noviembre del 2026.\nhttps://x.test/t?t=1');

  // Una línea con una etiqueta sin datos se quita entera; {fecha_frase} vacío solo se omite.
  const v = valoresDelMensaje({ ...datos, codigo: '', fechaSorteo: '' });
  assert.equal(renderizar('Gracias{fecha_frase}.\nCódigo: {codigo}\nFin {enlace}', v), 'Gracias.\nFin https://x.test/t?t=1');

  // Validación: etiquetas desconocidas y {enlace} obligatorio.
  assert.equal(validarPlantilla(PLANTILLA_ORIGINAL), '');
  assert.match(validarPlantilla('Hola {nombr} {enlace}'), /\{nombr\}/);
  assert.match(validarPlantilla('Hola {nombre}'), /\{enlace\}/);

  // Correo: viñetas en lista, negrita y enlaces; el texto plano no lleva asteriscos.
  const c = mensajeCorreo(datos);
  assert.match(c.html, /<ul><li>Las tablas están enumeradas/);
  assert.match(c.html, /<strong>¡Tus tablas de bingo!<\/strong>/);
  assert.match(c.html, /<a href="https:\/\/x\.test\/t\?t=1">/);
  assert.ok(!c.texto.includes('*'));
  assert.match(c.html, /No es requerido/, 'la línea sin viñeta continúa la viñeta anterior');

  // Guardar: igual al original se guarda vacío; uno propio se guarda; uno con errores se rechaza.
  const s = await nuevo();
  assert.equal((await s.evento()).textoMensaje, '');
  const m0 = await s.mensajeActual();
  assert.equal(m0.esPropio, false);
  assert.equal(m0.actual, PLANTILLA_ORIGINAL);
  await s.actualizarEvento({ textoMensaje: PLANTILLA_ORIGINAL.replace(/\n/g, '\r\n') });
  assert.equal((await s.evento()).textoMensaje, '', 'igual al original: sigue usando el original');
  await assert.rejects(() => s.actualizarEvento({ textoMensaje: 'Hola {nombr} {enlace}' }), /etiquetas que no existen/);
  await assert.rejects(() => s.actualizarEvento({ textoMensaje: 'Hola sin enlace' }), /\{enlace\}/);
  await s.actualizarEvento({ textoMensaje: 'Hola {nombre}, tus tablas {cantidad}: {enlace}' });
  assert.equal((await s.mensajeActual()).esPropio, true);
  await s.actualizarEvento({ nombre: 'Otro nombre' }); // otros cambios no borran el texto propio
  assert.equal((await s.evento()).textoMensaje, 'Hola {nombre}, tus tablas {cantidad}: {enlace}');

  // Vista previa con datos de ejemplo.
  const vp = await s.vistaPreviaMensaje('Hola {nombre}: {numeros} {enlace}');
  assert.match(vp, /^Hola Teresita: 12 y 87 https:\/\//);
  assert.match(await s.vistaPreviaMensaje(''), /Gracias, feliz día\.$/, 'vacío = texto original');
  await assert.rejects(() => s.vistaPreviaMensaje('sin enlace'), /\{enlace\}/);

  // El texto propio llega al WhatsApp manual; volver al original lo quita.
  await tablas(s, 2);
  const compra = await comprar(s, 1, { nombre: 'Luis Gómez' });
  await verificarTodo(s, compra.id);
  await s.enviarTablas(compra.id, { baseUrl: 'https://bingo.test' });
  const wa = decodeURIComponent((await s.enlaceWhatsapp(compra.id, 'https://bingo.test')).split('?text=')[1]);
  assert.match(wa, /^Hola Luis, tus tablas 1 tabla: https:\/\/bingo\.test\/tablas\.html\?t=/);
  await s.actualizarEvento({ textoMensaje: '' });
  assert.match(decodeURIComponent((await s.enlaceWhatsapp(compra.id, 'https://bingo.test')).split('?text=')[1]), /Gracias, feliz día\.$/);

  // Al empezar un Bingo nuevo, el texto del mensaje se conserva (es redacción, no datos del evento).
  await s.actualizarEvento({ textoMensaje: 'Hola {nombre}: {enlace}' });
  await s.reiniciarBingo({ nombre: 'Siguiente', confirmar: true });
  assert.equal((await s.evento()).textoMensaje, 'Hola {nombre}: {enlace}');
});

test('operadoras: configurables y quedan registradas al aprobar o rechazar un pago', async () => {
  const s = await nuevo();
  assert.deepEqual((await s.evento()).operadores, ['Claudia', 'Olga', 'Aura', 'Carmen', 'Alicia', 'Diana']);
  assert.equal(await s.operadorDe(' olga '), 'Olga', 'ignora mayúsculas y espacios');
  await assert.rejects(() => s.operadorDe(''), /quién aprueba/);
  await assert.rejects(() => s.operadorDe('Zulema'), /no está en la lista/);

  await tablas(s, 4);
  const a = await comprar(s, 1);
  const da = await s.detalleCompra(a.id);
  const v = await s.verificarPago(da.pagos[0].id, da.total, { operador: await s.operadorDe('Aura') });
  assert.equal(v.pagos[0].verificadoPor, 'Aura');

  const b = await comprar(s, 1, { nombre: 'Otra Persona' });
  const db_ = await s.detalleCompra(b.id);
  const r = await s.rechazarPago(db_.pagos[0].id, { operador: 'Carmen' });
  assert.equal(r.pagos[0].verificadoPor, 'Carmen');

  // Cambiar la lista: sin duplicados ni líneas vacías; sin lista ya no se exige.
  await s.actualizarEvento({ operadores: 'Rosa\n\n Rosa \nLuz, Marta' });
  assert.deepEqual((await s.evento()).operadores, ['Rosa', 'Luz', 'Marta']);
  await s.actualizarEvento({ operadores: '' });
  assert.equal(await s.operadorDe(''), '');
});

test('reiniciar el sorteo borra balotas y ganadoras pero respeta compras y tablas vendidas', async () => {
  const s = await nuevo();
  const { p, serial, compra } = await ronda(s, 'linea');
  await assert.rejects(() => s.reiniciarSorteo(), /Confirma/);
  await s.iniciarRonda(p.id);
  for (const n of [1, 16, 31, 46, 61]) await s.cantarBalota(p.id, n);
  await s.asignarGanador(p.id, serial);

  const r = await s.reiniciarSorteo({ confirmar: true });
  assert.deepEqual(r, { balotas: 5, ganadoras: 1 });
  const [premio] = await s.listarPremios();
  assert.equal(premio.rondaEstado, 'pendiente');
  assert.equal(premio.ganadores.length, 0);
  assert.equal((await s.estadoSorteo()).ronda, null);
  assert.equal((await s.detalleCompra(compra.id)).estado, 'enviada');
  assert.equal((await s.db.query("SELECT COUNT(*)::int AS n FROM tablas WHERE estado = 'vendida'"))[0].n, 1);

  // La ronda se puede volver a jugar desde cero.
  await s.iniciarRonda(p.id);
  assert.deepEqual((await s.estadoSorteo()).balotas, []);
});
