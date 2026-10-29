const crypto = require('node:crypto');
const { crearCorreo } = require('./correo');

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_TABLAS_POR_COMPRA = 50;
const MAX_TABLAS_LOTE = 500;
const LOCK_VENTAS = 7001;
const LOCK_TABLAS = 7002;

class ErrorApp extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

const redondear = n => Math.round(Number(n || 0) * 100) / 100;
const num = v => Number(v ?? 0);
const ahora = () => new Date().toISOString();

const enteroPositivo = (v, nombre) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ErrorApp(`${nombre} debe ser un número entero mayor que 0.`);
  return n;
};
const montoPositivo = (v, nombre) => {
  const n = redondear(v);
  if (!(n > 0)) throw new ErrorApp(`${nombre} debe ser mayor que 0.`);
  return n;
};
const texto = (v, nombre, max = 120) => {
  const t = String(v ?? '').trim();
  if (!t) throw new ErrorApp(`Falta ${nombre.toLowerCase()}.`);
  if (t.length > max) throw new ErrorApp(`${nombre} es demasiado largo.`);
  return t;
};

// Consulta de compras con pagado y tablas ya calculados.
const SQL_COMPRAS = `
  SELECT c.*,
    COALESCE((SELECT SUM(p.monto_verificado) FROM pagos p WHERE p.compra_id = c.id AND p.estado = 'verificado'), 0) AS pagado,
    COALESCE((SELECT SUM(p.monto_reportado) FROM pagos p WHERE p.compra_id = c.id AND p.estado <> 'rechazado'), 0) AS reportado,
    COALESCE((SELECT array_agg(t.serial ORDER BY t.serial) FROM tablas t WHERE t.compra_id = c.id), '{}') AS tablas
  FROM compras c`;

// Cuántas tablas cubre un monto al precio dado (siempre hacia abajo: nunca se regala una tabla).
const tablasPorMonto = (monto, precio) => (precio > 0 ? Math.floor(redondear(monto) / precio + 1e-9) : 0);
// Orden natural de seriales: 2 antes que 10 (con texto simple '10' quedaría antes que '2').
const porSerial = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANALES = ['whatsapp', 'correo', 'fisica'];

function crearServicios({ db, whatsapp, correo = crearCorreo({}) }) {
  const q = (sql, params) => db.query(sql, params);
  const uno = async (sql, params) => (await q(sql, params))[0];

  // Dentro de una transacción se usa el ejecutor "t", no q, para ver los cambios no confirmados.
  const bitacora = (accion, detalle, t = q) =>
    t('INSERT INTO bitacora (fecha, accion, detalle) VALUES ($1, $2, $3)', [ahora(), accion, detalle]);

  // ---------- Evento ----------
  // conQr=false deja fuera la imagen del QR (pesa) y solo avisa si existe; el panel la pide aparte al editar.
  async function evento({ conQr = true } = {}) {
    const e = await uno('SELECT * FROM evento WHERE id = 1');
    return {
      nombre: e.nombre,
      precioTabla: num(e.precio_tabla),
      moneda: e.moneda,
      fechaSorteo: e.fecha_sorteo,
      cuentasPago: e.cuentas_pago,
      exigirPagoCompleto: Boolean(e.exigir_pago_completo),
      banco: e.banco ?? '',
      tipoCuenta: e.tipo_cuenta ?? '',
      numeroCuenta: e.numero_cuenta ?? '',
      titularCuenta: e.titular_cuenta ?? '',
      llavePago: e.llave_pago ?? '',
      tieneQr: Boolean(e.qr_pago),
      ...(conQr ? { qrPago: e.qr_pago ?? '' } : {}),
    };
  }

  const QR_VALIDO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const QR_MAX_CARACTERES = 600000; // ~450 KB de imagen

  async function actualizarEvento(datos) {
    const actual = await evento();
    const tipoCuenta = String(datos.tipoCuenta ?? actual.tipoCuenta).trim();
    if (!['', 'Ahorros', 'Corriente'].includes(tipoCuenta)) throw new ErrorApp('El tipo de cuenta debe ser Ahorros o Corriente.');
    // undefined conserva la imagen actual; una cadena vacía la quita.
    const qrPago = datos.qrPago === undefined ? actual.qrPago : String(datos.qrPago);
    if (qrPago && (qrPago.length > QR_MAX_CARACTERES || !QR_VALIDO.test(qrPago))) {
      throw new ErrorApp('El QR debe ser una imagen PNG, JPG o WEBP de máximo 400 KB.');
    }
    const nuevo = {
      nombre: String(datos.nombre ?? actual.nombre).trim().slice(0, 120),
      precioTabla: datos.precioTabla === undefined ? actual.precioTabla : redondear(datos.precioTabla),
      moneda: String(datos.moneda ?? actual.moneda).trim().slice(0, 10),
      fechaSorteo: String(datos.fechaSorteo ?? actual.fechaSorteo).slice(0, 10),
      cuentasPago: String(datos.cuentasPago ?? actual.cuentasPago).slice(0, 2000),
      exigirPagoCompleto: datos.exigirPagoCompleto === undefined ? actual.exigirPagoCompleto : Boolean(datos.exigirPagoCompleto),
      banco: String(datos.banco ?? actual.banco).trim().slice(0, 80),
      tipoCuenta,
      numeroCuenta: String(datos.numeroCuenta ?? actual.numeroCuenta).trim().slice(0, 40),
      titularCuenta: String(datos.titularCuenta ?? actual.titularCuenta).trim().slice(0, 120),
      llavePago: String(datos.llavePago ?? actual.llavePago).trim().slice(0, 80),
      qrPago,
    };
    if (!(nuevo.precioTabla >= 0)) throw new ErrorApp('El precio no puede ser negativo.');
    await q(
      `UPDATE evento SET nombre=$1, precio_tabla=$2, moneda=$3, fecha_sorteo=$4, cuentas_pago=$5, exigir_pago_completo=$6,
         banco=$7, tipo_cuenta=$8, numero_cuenta=$9, titular_cuenta=$10, llave_pago=$11, qr_pago=$12 WHERE id = 1`,
      [nuevo.nombre, nuevo.precioTabla, nuevo.moneda, nuevo.fechaSorteo, nuevo.cuentasPago, nuevo.exigirPagoCompleto,
        nuevo.banco, nuevo.tipoCuenta, nuevo.numeroCuenta, nuevo.titularCuenta, nuevo.llavePago, nuevo.qrPago],
    );
    await bitacora('configuración', `Precio ${nuevo.precioTabla} ${nuevo.moneda}`);
    return evento();
  }

  // ---------- Tablas ----------
  async function tablasDisponibles(t = q) {
    return num((await t("SELECT COUNT(*) AS n FROM tablas WHERE estado = 'disponible'"))[0].n);
  }

  // Libres = disponibles menos las ya prometidas a compras abiertas.
  async function tablasLibresParaVender(t = q) {
    const comprometidas = num((await t(
      "SELECT COALESCE(SUM(cantidad), 0) AS n FROM compras WHERE estado IN ('por_verificar','verificada')",
    ))[0].n);
    return (await tablasDisponibles(t)) - comprometidas;
  }

  function serialNuevo() {
    const bytes = crypto.randomBytes(8);
    let s = '';
    for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
    return `BNG-${s.slice(0, 4)}-${s.slice(4)}`;
  }

  async function generarTablas(cantidad) {
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TABLAS_LOTE) {
      throw new ErrorApp(`Indica una cantidad entre 1 y ${MAX_TABLAS_LOTE}.`);
    }
    const creadas = await db.tx(async t => {
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_TABLAS]);
      let total = 0;
      while (total < n) {
        const filas = await t(
          'INSERT INTO tablas (serial, creada_en) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING serial',
          [serialNuevo(), ahora()],
        );
        total += filas.length;
      }
      return total;
    });
    await bitacora('lote de tablas', `${creadas} tabla(s) nuevas`);
    return { creadas };
  }

  // Acepta seriales uno por línea o separados por coma, punto y coma o tab. Repetidos y vacíos se ignoran.
  async function importarTablas(entrada) {
    const seriales = [...new Set(
      String(entrada || '').split(/[\r\n,;\t]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
    )].map(s => s.slice(0, 40));
    if (!seriales.length) throw new ErrorApp('No hay seriales para importar.');
    const insertadas = await db.tx(async t => {
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_TABLAS]);
      const filas = await t(
        'INSERT INTO tablas (serial, creada_en) SELECT unnest($1::text[]), $2 ON CONFLICT DO NOTHING RETURNING serial',
        [seriales, ahora()],
      );
      return filas.length;
    });
    await bitacora('importación de tablas', `${insertadas} nueva(s) de ${seriales.length} leída(s)`);
    return { leidas: seriales.length, insertadas, repetidas: seriales.length - insertadas };
  }

  async function listarTablas() {
    const filas = await q(`SELECT t.serial, t.estado, t.vendida_en, c.codigo AS compra_codigo
      FROM tablas t LEFT JOIN compras c ON c.id = t.compra_id ORDER BY t.serial`);
    return filas.map(t => ({ serial: t.serial, estado: t.estado, vendidaEn: t.vendida_en, compraCodigo: t.compra_codigo }));
  }

  // ---------- Compras ----------
  async function codigoCompra(t = q) {
    for (let intento = 0; intento < 10; intento++) {
      const bytes = crypto.randomBytes(6);
      let s = '';
      for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
      const codigo = `BNG-${s}`;
      if (!(await t('SELECT 1 FROM compras WHERE codigo = $1', [codigo])).length) return codigo;
    }
    throw new Error('No se pudo generar un código de compra.');
  }

  async function comprobantesDePagos(pagoIds) {
    if (!pagoIds.length) return {};
    const filas = await q('SELECT * FROM comprobantes WHERE pago_id = ANY($1::int[]) ORDER BY id', [pagoIds]);
    const porPago = {};
    for (const f of filas) (porPago[f.pago_id] ||= []).push({ id: f.id, nombre: f.nombre, tipo: f.tipo });
    return porPago;
  }

  function compraDTO(c) {
    const pagado = redondear(num(c.pagado));
    const total = num(c.total);
    const precio = num(c.precio_unitario);
    return {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      cedula: c.cedula,
      telefono: c.telefono,
      correo: c.correo,
      ciudad: c.ciudad,
      referidoPor: c.referido_por,
      cantidad: c.cantidad,
      tablasAprobadas: c.tablas_aprobadas,
      // Lo que cubre el dinero ya verificado y lo que cubre lo reportado por el comprador.
      tablasSugeridas: tablasPorMonto(pagado, precio),
      tablasReportadas: tablasPorMonto(num(c.reportado), precio),
      precioUnitario: precio,
      total,
      pagado,
      saldo: redondear(Math.max(0, total - pagado)),
      estado: c.estado,
      whatsappEstado: c.whatsapp_estado,
      whatsappError: c.whatsapp_error,
      correoEstado: c.correo_estado,
      correoError: c.correo_error,
      fisicaEstado: c.fisica_estado,
      fisicaNota: c.fisica_nota,
      fisicaEn: c.fisica_en,
      tokenEntrega: c.token_entrega,
      sobranteDestino: c.sobrante_destino,
      sobranteNota: c.sobrante_nota,
      sobranteMonto: num(c.sobrante_monto),
      sobranteEstado: c.sobrante_estado,
      sobranteResolucion: c.sobrante_resolucion,
      sobranteEn: c.sobrante_en,
      creadaEn: c.creada_en,
      verificadaEn: c.verificada_en,
      enviadaEn: c.enviada_en,
      tablas: [...(c.tablas || [])].sort(porSerial),
    };
  }

  function pagoDTO(p, comprobantes) {
    return {
      id: p.id,
      compraId: p.compra_id,
      montoReportado: num(p.monto_reportado),
      montoVerificado: p.monto_verificado == null ? null : num(p.monto_verificado),
      metodo: p.metodo,
      referencia: p.referencia,
      fechaPago: p.fecha_pago,
      estado: p.estado,
      comprobantes: comprobantes || [],
      creadoEn: p.creado_en,
      verificadoEn: p.verificado_en,
    };
  }

  async function listarCompras({ estado } = {}) {
    const filas = estado
      ? await q(`${SQL_COMPRAS} WHERE c.estado = $1 ORDER BY c.id DESC`, [estado])
      : await q(`${SQL_COMPRAS} ORDER BY c.id DESC`);
    return filas.map(compraDTO);
  }

  async function detalleCompra(id) {
    const c = await uno(`${SQL_COMPRAS} WHERE c.id = $1`, [id]);
    if (!c) throw new ErrorApp('Compra no encontrada.', 404);
    const pagos = await q('SELECT * FROM pagos WHERE compra_id = $1 ORDER BY id', [id]);
    const comp = await comprobantesDePagos(pagos.map(p => p.id));
    return { ...compraDTO(c), pagos: pagos.map(p => pagoDTO(p, comp[p.id])) };
  }

  // comprobantes: [{ ruta, nombre, tipo }] ya subidos a Storage y verificados por la capa HTTP.
  async function crearCompra(datos, comprobantes = []) {
    const e = await evento();
    if (!(e.precioTabla > 0)) throw new ErrorApp('Las compras están cerradas: el precio aún no está configurado.', 409);

    // Campos del formulario del bingo: nombre, celular, ciudad, quién lo refirió, valor y fecha de la consignación,
    // número de tablas y soporte. Cédula y correo son opcionales; el efectivo no lleva comprobante.
    const cantidad = enteroPositivo(datos.cantidad, 'El número de tablas');
    if (cantidad > MAX_TABLAS_POR_COMPRA) throw new ErrorApp(`Máximo ${MAX_TABLAS_POR_COMPRA} tablas por compra.`);
    const metodo = texto(datos.metodo, 'Método de pago', 40);
    const esEfectivo = /efectivo/i.test(metodo);
    if (!esEfectivo && !comprobantes.length) throw new ErrorApp('Adjunta el comprobante de la consignación.');
    const correoComprador = String(datos.correo ?? '').trim().slice(0, 120);
    if (correoComprador && !CORREO_VALIDO.test(correoComprador)) throw new ErrorApp('El correo no es válido.');
    const hoy = ahora().slice(0, 10);
    const fechaPago = String(datos.fechaPago || (esEfectivo ? hoy : '')).trim();
    if (!FECHA_ISO.test(fechaPago)) throw new ErrorApp('Indica la fecha de la consignación.');
    if (fechaPago > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw new ErrorApp('La fecha del pago no puede ser futura.');
    const d = {
      nombre: texto(datos.nombre, 'Nombre'),
      cedula: String(datos.cedula ?? '').trim().slice(0, 20),
      telefono: normalizarTelefono(datos.telefono),
      correo: correoComprador,
      ciudad: texto(datos.ciudad, 'Ciudad', 80),
      referidoPor: texto(datos.referidoPor, 'Quién le habló del bingo', 120),
      metodo,
      referencia: String(datos.referencia ?? '').trim().slice(0, 60) || (esEfectivo ? 'Efectivo' : 'Sin referencia'),
    };
    const total = redondear(cantidad * e.precioTabla);
    const montoPagado = montoPositivo(datos.montoPagado, 'El valor pagado');

    // Lo que sobra al pagar por encima de las tablas que cubre el valor (consignación o efectivo):
    // el comprador decide si lo dona o si se lo devolvemos, y en ese caso deja una nota de cómo.
    const cubiertas = tablasPorMonto(montoPagado, e.precioTabla);
    if (cubiertas < 1) throw new ErrorApp(`El valor pagado no alcanza para una tabla (${e.precioTabla}).`);
    const sobranteEstimado = redondear(montoPagado - cubiertas * e.precioTabla);
    let sobranteDestino = '';
    let sobranteNota = '';
    if (sobranteEstimado > 0) {
      sobranteDestino = String(datos.sobranteDestino ?? '').trim();
      if (!['donacion', 'devolucion'].includes(sobranteDestino)) {
        throw new ErrorApp(`Sobran ${sobranteEstimado}: indica si los donas o si prefieres que te los devolvamos.`);
      }
      sobranteNota = sobranteDestino === 'devolucion'
        ? texto(datos.sobranteNota, 'La nota de cómo devolverte el dinero', 300)
        : String(datos.sobranteNota ?? '').trim().slice(0, 300);
    }

    return db.tx(async t => {
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_VENTAS]);
      if (cantidad > await tablasLibresParaVender(t)) {
        throw new ErrorApp('No hay suficientes tablas disponibles para esta cantidad. Intenta con menos tablas.', 409);
      }
      const codigo = await codigoCompra(t);
      const [{ id }] = await t(
        `INSERT INTO compras (codigo, nombre, cedula, telefono, correo, ciudad, referido_por, cantidad, precio_unitario, total,
           sobrante_destino, sobrante_nota, estado, creada_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'por_verificar', $13) RETURNING id`,
        [codigo, d.nombre, d.cedula, d.telefono, d.correo, d.ciudad, d.referidoPor, cantidad, e.precioTabla, total,
          sobranteDestino, sobranteNota, ahora()],
      );
      const [{ id: pagoId }] = await t(
        `INSERT INTO pagos (compra_id, monto_reportado, metodo, referencia, fecha_pago, estado, creado_en)
         VALUES ($1, $2, $3, $4, $5, 'por_verificar', $6) RETURNING id`,
        [id, montoPagado, d.metodo, d.referencia, fechaPago, ahora()],
      );
      for (const c of comprobantes) {
        await t('INSERT INTO comprobantes (pago_id, ruta, nombre, tipo) VALUES ($1, $2, $3, $4)',
          [pagoId, c.ruta, String(c.nombre).slice(0, 120), c.tipo]);
      }
      await bitacora('compra registrada', `${codigo} · ${d.nombre} · ${cantidad} tabla(s) · pagó ${montoPagado}`, t);
      return { id: Number(id), codigo, total, tablasSugeridas: cubiertas, sobrante: sobranteEstimado, sobranteDestino };
    });
  }

  function normalizarTelefono(texto) {
    return whatsapp.normalizarTelefono(texto);
  }

  async function estadoPublico(codigo) {
    const c = await uno('SELECT codigo, cantidad, tablas_aprobadas, total, estado FROM compras WHERE codigo = $1', [String(codigo || '').trim().toUpperCase()]);
    if (!c) throw new ErrorApp('No encontramos una compra con ese código.', 404);
    return { codigo: c.codigo, cantidad: c.tablas_aprobadas ?? c.cantidad, total: num(c.total), estado: c.estado };
  }

  async function registrarPagoManual(compraId, datos) {
    const c = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
    if (!c) throw new ErrorApp('Compra no encontrada.', 404);
    if (c.estado === 'rechazada') throw new ErrorApp('La compra está rechazada.', 409);
    const monto = montoPositivo(datos.monto, 'El monto');
    const metodo = texto(datos.metodo, 'Método de pago', 40);
    const referencia = String(datos.referencia ?? '').trim().slice(0, 60) || 'Manual';
    await db.tx(async t => {
      await t(
        `INSERT INTO pagos (compra_id, monto_reportado, monto_verificado, metodo, referencia, fecha_pago, estado, creado_en, verificado_en)
         VALUES ($1, $2, $2, $3, $4, $5, 'verificado', $6, $6)`,
        [compraId, monto, metodo, referencia, FECHA_ISO.test(String(datos.fechaPago || '')) ? datos.fechaPago : ahora().slice(0, 10), ahora()],
      );
      if (c.estado === 'por_verificar') {
        await t("UPDATE compras SET estado = 'verificada', verificada_en = $1 WHERE id = $2", [ahora(), compraId]);
      }
      await bitacora('pago registrado', `${c.codigo}: ${monto} (${metodo})`, t);
    });
    return detalleCompra(compraId);
  }

  async function verificarPago(pagoId, montoVerificado) {
    const p = await uno('SELECT * FROM pagos WHERE id = $1', [pagoId]);
    if (!p) throw new ErrorApp('Pago no encontrado.', 404);
    if (p.estado !== 'por_verificar') throw new ErrorApp('Este pago ya fue procesado.', 409);
    const monto = montoPositivo(montoVerificado, 'El monto verificado');
    const c = await uno('SELECT * FROM compras WHERE id = $1', [p.compra_id]);
    await db.tx(async t => {
      const act = await t(
        "UPDATE pagos SET estado = 'verificado', monto_verificado = $1, verificado_en = $2 WHERE id = $3 AND estado = 'por_verificar' RETURNING id",
        [monto, ahora(), pagoId],
      );
      if (!act.length) throw new ErrorApp('Este pago ya fue procesado.', 409);
      if (c.estado === 'por_verificar') {
        await t("UPDATE compras SET estado = 'verificada', verificada_en = $1 WHERE id = $2", [ahora(), c.id]);
      }
      await bitacora('pago verificado', `${c.codigo}: ${monto} (${p.metodo} ${p.referencia})`, t);
    });
    return detalleCompra(c.id);
  }

  async function rechazarPago(pagoId) {
    const p = await uno('SELECT * FROM pagos WHERE id = $1', [pagoId]);
    if (!p) throw new ErrorApp('Pago no encontrado.', 404);
    if (p.estado !== 'por_verificar') throw new ErrorApp('Este pago ya fue procesado.', 409);
    await q("UPDATE pagos SET estado = 'rechazado', verificado_en = $1 WHERE id = $2", [ahora(), pagoId]);
    const c = await uno('SELECT codigo FROM compras WHERE id = $1', [p.compra_id]);
    await bitacora('pago rechazado', `${c.codigo}: ${p.referencia}`);
    return detalleCompra(p.compra_id);
  }

  async function pagadoDe(compraId, t = q) {
    return redondear(num((await t(
      "SELECT COALESCE(SUM(monto_verificado), 0) AS n FROM pagos WHERE compra_id = $1 AND estado = 'verificado'", [compraId],
    ))[0].n));
  }

  // Canales elegidos por quien envía. Sin indicar ninguno se usa WhatsApp, como antes.
  function canalesDe(entrada) {
    if (entrada == null) return { whatsapp: true, correo: false, fisica: false };
    const c = {};
    for (const k of CANALES) c[k] = Boolean(entrada[k]);
    if (!CANALES.some(k => c[k])) throw new ErrorApp('Elige al menos un canal de entrega: WhatsApp, correo o entrega física.');
    return c;
  }

  const enlaceEntrega = (baseUrl, token) => (baseUrl && token ? `${String(baseUrl).replace(/\/$/, '')}/tablas.html?t=${token}` : null);

  // "Enviar Tablas": quien verificó el pago define cuántas tablas se entregan; se asignan sin duplicados y se envían.
  // opciones: { cantidad, canales: { whatsapp, correo, fisica }, baseUrl }
  async function enviarTablas(compraId, opciones = {}) {
    const canales = canalesDe(opciones.canales);
    const previa = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
    if (!previa) throw new ErrorApp('Compra no encontrada.', 404);
    if (previa.estado !== 'verificada') throw new ErrorApp('Solo se pueden enviar tablas de compras verificadas.', 409);
    if (canales.correo && !previa.correo) throw new ErrorApp('Esta compra no tiene correo registrado.', 409);
    const exigir = (await evento()).exigirPagoCompleto;

    // Todo ocurre en una sola transacción con el candado de ventas: la validación y la asignación no se pueden
    // intercalar con otra venta. Si algo falla, no queda ninguna tabla asignada.
    const { seriales, token } = await db.tx(async t => {
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_VENTAS]);
      const [c] = await t('SELECT * FROM compras WHERE id = $1 FOR UPDATE', [compraId]);
      if (c.estado !== 'verificada') throw new ErrorApp('Esta compra ya fue procesada.', 409);

      const pagado = await pagadoDe(compraId, t);
      if (!(pagado > 0)) throw new ErrorApp('La compra no tiene pagos verificados.', 409);
      const precio = num(c.precio_unitario);
      const cubiertas = tablasPorMonto(pagado, precio);
      const cantidad = enteroPositivo(opciones.cantidad ?? cubiertas, 'La cantidad de tablas a enviar');
      if (exigir && cantidad > cubiertas) {
        throw new ErrorApp(`El pago verificado (${pagado}) cubre solo ${cubiertas} tabla(s) a ${precio}. No se pueden enviar ${cantidad}.`, 409);
      }

      // SKIP LOCKED: si otra venta tiene una tabla bloqueada, se toma la siguiente libre.
      const asignadas = await t(
        `UPDATE tablas SET estado = 'vendida', compra_id = $1, vendida_en = $2
         WHERE estado = 'disponible' AND serial IN (
           SELECT serial FROM tablas WHERE estado = 'disponible'
           ORDER BY random() LIMIT $3 FOR UPDATE SKIP LOCKED
         )
         RETURNING serial`,
        [compraId, ahora(), cantidad],
      );
      if (asignadas.length !== cantidad) {
        throw new ErrorApp(`Faltan tablas: hay ${asignadas.length} disponibles y se piden ${cantidad}. Agrega más tablas.`, 409);
      }
      // Verificación final: lo que la base dice que es de esta compra coincide exactamente con lo asignado.
      const [{ n }] = await t('SELECT COUNT(*)::int AS n FROM tablas WHERE compra_id = $1', [compraId]);
      if (n !== cantidad) throw new Error(`Control de tablas: la compra ${c.codigo} quedó con ${n} tabla(s), se esperaban ${cantidad}.`);

      // Sobrante = lo verificado por encima de las tablas entregadas. Si el comprador eligió donarlo queda como
      // donación; si pidió devolución, por devolver; si no eligió nada, por definir para que la administración decida.
      const sobrante = Math.max(0, redondear(pagado - cantidad * precio));
      const estadoSobrante = sobrante <= 0 ? 'ninguno'
        : c.sobrante_destino === 'donacion' ? 'donado'
          : c.sobrante_destino === 'devolucion' ? 'por_devolver' : 'por_definir';

      const token = crypto.randomBytes(16).toString('hex');
      await t(
        `UPDATE compras SET estado = 'enviada', enviada_en = $1, tablas_aprobadas = $2, total = $3,
           token_entrega = $4, fisica_estado = $5, sobrante_monto = $6::numeric, sobrante_estado = $7,
           sobrante_en = CASE WHEN $6::numeric > 0 THEN $1::text ELSE NULL END WHERE id = $8`,
        [ahora(), cantidad, redondear(cantidad * precio), token, canales.fisica ? 'pendiente' : 'no', sobrante, estadoSobrante, compraId],
      );
      if (sobrante > 0) await bitacora('sobrante', `${c.codigo}: ${sobrante} (${estadoSobrante.replace('_', ' ')})`, t);
      const lista = asignadas.map(r => r.serial).sort(porSerial);
      await bitacora('tablas asignadas', `${c.codigo}: ${lista.join(', ')} (pidió ${c.cantidad}, pagó ${pagado}, se aprobaron ${cantidad})`, t);
      return { seriales: lista, token };
    });

    const c = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
    const enlace = enlaceEntrega(opciones.baseUrl, token);
    if (canales.whatsapp) await entregarWhatsApp(c, seriales, enlace);
    if (canales.correo) await entregarCorreo(c, seriales, enlace);
    if (canales.fisica) await bitacora('entrega física pendiente', c.codigo);
    return detalleCompra(compraId);
  }

  async function datosEntrega(compraId) {
    const c = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
    if (!c) throw new ErrorApp('Compra no encontrada.', 404);
    if (c.estado !== 'enviada') throw new ErrorApp('Esta compra aún no tiene tablas asignadas.', 409);
    const seriales = (await q('SELECT serial FROM tablas WHERE compra_id = $1 ORDER BY serial', [compraId])).map(r => r.serial).sort(porSerial);
    return { c, seriales };
  }

  // Reintenta los canales indicados con las mismas tablas ya asignadas.
  async function reenviar(compraId, { canales, baseUrl } = {}) {
    const elegidos = canalesDe(canales);
    const { c, seriales } = await datosEntrega(compraId);
    const enlace = enlaceEntrega(baseUrl, c.token_entrega);
    if (elegidos.whatsapp) await entregarWhatsApp(c, seriales, enlace);
    if (elegidos.correo) {
      if (!c.correo) throw new ErrorApp('Esta compra no tiene correo registrado.', 409);
      await entregarCorreo(c, seriales, enlace);
    }
    return detalleCompra(compraId);
  }

  async function entregarWhatsApp(c, seriales, enlace) {
    try {
      const r = await whatsapp.enviarTablas({ telefono: c.telefono, nombre: c.nombre, seriales, enlace });
      if (r.estado === 'enviado') {
        await q("UPDATE compras SET whatsapp_estado = 'enviado', whatsapp_error = NULL WHERE id = $1", [c.id]);
        await bitacora('tablas enviadas', `${c.codigo} por WhatsApp`);
      } else {
        await q("UPDATE compras SET whatsapp_estado = 'manual', whatsapp_error = NULL WHERE id = $1", [c.id]);
        await bitacora('envío manual pendiente', `${c.codigo}: WhatsApp no configurado`);
      }
    } catch (err) {
      await q("UPDATE compras SET whatsapp_estado = 'fallido', whatsapp_error = $1 WHERE id = $2", [String(err.message).slice(0, 500), c.id]);
      await bitacora('falló envío WhatsApp', `${c.codigo}: ${err.message}`);
    }
  }

  async function entregarCorreo(c, seriales, enlace) {
    try {
      const r = await correo.enviarTablas({ correo: c.correo, nombre: c.nombre, seriales, enlace });
      if (r.estado === 'enviado') {
        await q("UPDATE compras SET correo_estado = 'enviado', correo_error = NULL WHERE id = $1", [c.id]);
        await bitacora('tablas enviadas', `${c.codigo} por correo`);
      } else {
        await q("UPDATE compras SET correo_estado = 'manual', correo_error = NULL WHERE id = $1", [c.id]);
        await bitacora('envío manual pendiente', `${c.codigo}: correo no configurado`);
      }
    } catch (err) {
      await q("UPDATE compras SET correo_estado = 'fallido', correo_error = $1 WHERE id = $2", [String(err.message).slice(0, 500), c.id]);
      await bitacora('falló envío correo', `${c.codigo}: ${err.message}`);
    }
  }

  async function enlaceWhatsapp(compraId, baseUrl) {
    const { c, seriales } = await datosEntrega(compraId);
    return whatsapp.enlaceManual(c.telefono, c.nombre, seriales, enlaceEntrega(baseUrl, c.token_entrega));
  }

  async function enlaceCorreo(compraId, baseUrl) {
    const { c, seriales } = await datosEntrega(compraId);
    if (!c.correo) throw new ErrorApp('Esta compra no tiene correo registrado.', 409);
    return correo.enlaceManual(c.correo, c.nombre, seriales, enlaceEntrega(baseUrl, c.token_entrega));
  }

  // Confirma a mano un envío que se hizo fuera del sistema (enlace wa.me / mailto).
  async function marcarEnviadoManual(compraId, canal = 'whatsapp') {
    const { c } = await datosEntrega(compraId);
    if (canal === 'correo') {
      await q("UPDATE compras SET correo_estado = 'enviado', correo_error = NULL WHERE id = $1", [compraId]);
    } else if (canal === 'whatsapp') {
      await q("UPDATE compras SET whatsapp_estado = 'enviado', whatsapp_error = NULL WHERE id = $1", [compraId]);
    } else {
      throw new ErrorApp('Canal no válido.');
    }
    await bitacora('envío confirmado a mano', `${c.codigo} (${canal})`);
    return detalleCompra(compraId);
  }

  // Entrega física: se marca pendiente (se va a entregar) o entregada (con una nota, ej. quién la recibió).
  async function entregaFisica(compraId, { estado, nota } = {}) {
    const { c } = await datosEntrega(compraId);
    if (!['pendiente', 'entregada'].includes(estado)) throw new ErrorApp('Estado de entrega física no válido.');
    const detalle = String(nota ?? '').trim().slice(0, 300) || null;
    await q('UPDATE compras SET fisica_estado = $1, fisica_nota = $2, fisica_en = $3 WHERE id = $4',
      [estado, detalle, estado === 'entregada' ? ahora() : null, compraId]);
    await bitacora(estado === 'entregada' ? 'entrega física realizada' : 'entrega física pendiente', `${c.codigo}${detalle ? ': ' + detalle : ''}`);
    return detalleCompra(compraId);
  }

  // Vista pública del comprador: solo se obtiene con el token privado y solo muestra SUS tablas.
  async function entregaPublica(token) {
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new ErrorApp('Enlace no válido.', 404);
    const c = await uno("SELECT id, nombre FROM compras WHERE token_entrega = $1 AND estado = 'enviada'", [token]);
    if (!c) throw new ErrorApp('Enlace no válido.', 404);
    const seriales = (await q('SELECT serial FROM tablas WHERE compra_id = $1 ORDER BY serial', [c.id])).map(r => r.serial).sort(porSerial);
    return { nombre: c.nombre, evento: (await evento()).nombre, tablas: seriales };
  }

  // Datos con los que se sella cada imagen. Solo los usa la ruta de la imagen; nunca salen en el JSON público.
  async function datosSelloEntrega(token) {
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new ErrorApp('Enlace no válido.', 404);
    const c = await uno("SELECT id, codigo, nombre, telefono FROM compras WHERE token_entrega = $1 AND estado = 'enviada'", [token]);
    if (!c) throw new ErrorApp('Enlace no válido.', 404);
    const tablas = (await q('SELECT serial FROM tablas WHERE compra_id = $1 ORDER BY serial', [c.id])).map(r => r.serial).sort(porSerial);
    return { nombre: c.nombre, telefono: c.telefono, codigo: c.codigo, tablas };
  }

  // ---------- Sobrantes (donaciones y devoluciones) ----------
  // Transiciones permitidas, para que el control sea claro y no se pueda "donar" lo que el comprador pidió devolver:
  //   por definir -> donado | por devolver      por devolver -> devuelto (con nota de cómo se devolvió)
  async function gestionarSobrante(compraId, { accion, nota } = {}) {
    const c = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
    if (!c) throw new ErrorApp('Compra no encontrada.', 404);
    if (!(num(c.sobrante_monto) > 0)) throw new ErrorApp('Esta compra no tiene sobrante.', 409);
    const reglas = {
      donar: { desde: 'por_definir', hacia: 'donado' },
      por_devolver: { desde: 'por_definir', hacia: 'por_devolver' },
      devuelto: { desde: 'por_devolver', hacia: 'devuelto' },
    };
    const r = reglas[accion];
    if (!r) throw new ErrorApp('Acción de sobrante no válida.');
    if (c.sobrante_estado !== r.desde) {
      throw new ErrorApp(`No se puede pasar de "${c.sobrante_estado.replace('_', ' ')}" a "${r.hacia.replace('_', ' ')}".`, 409);
    }
    const detalle = String(nota ?? '').trim().slice(0, 300);
    if (accion === 'devuelto' && !detalle) throw new ErrorApp('Anota cómo se devolvió el dinero (fecha, medio o referencia).');
    if (accion === 'por_devolver' && !detalle && !c.sobrante_nota) throw new ErrorApp('Anota cómo se le devolverá el dinero (cuenta, llave, etc.).');
    const act = await q(
      `UPDATE compras SET sobrante_estado = $1::text, sobrante_en = $2::text,
         sobrante_nota = CASE WHEN $1::text = 'por_devolver' AND $3::text <> '' THEN $3::text ELSE sobrante_nota END,
         sobrante_resolucion = CASE WHEN $1::text = 'por_devolver' THEN sobrante_resolucion ELSE NULLIF($3::text, '') END
       WHERE id = $4 AND sobrante_estado = $5 RETURNING id`,
      [r.hacia, ahora(), detalle, compraId, r.desde],
    );
    if (!act.length) throw new ErrorApp('El sobrante ya fue procesado por otra persona. Actualiza la lista.', 409);
    await bitacora(`sobrante ${r.hacia.replace('_', ' ')}`, `${c.codigo}: ${num(c.sobrante_monto)}${detalle ? ' · ' + detalle : ''}`);
    return detalleCompra(compraId);
  }

  async function listarSobrantes() {
    const filas = await q(`${SQL_COMPRAS} WHERE c.sobrante_monto > 0
      ORDER BY CASE c.sobrante_estado WHEN 'por_definir' THEN 0 WHEN 'por_devolver' THEN 1 ELSE 2 END, c.id DESC`);
    return filas.map(compraDTO);
  }

  async function rechazarCompra(compraId) {
    const c = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
    if (!c) throw new ErrorApp('Compra no encontrada.', 404);
    if (c.estado === 'enviada') throw new ErrorApp('Ya se enviaron las tablas; no se puede rechazar.', 409);
    if (c.estado === 'rechazada') throw new ErrorApp('La compra ya está rechazada.', 409);
    if (await pagadoDe(compraId) > 0) throw new ErrorApp('Tiene pagos verificados. Regístralo como devolución antes de rechazarla.', 409);
    await db.tx(async t => {
      await t("UPDATE pagos SET estado = 'rechazado', verificado_en = $1 WHERE compra_id = $2 AND estado = 'por_verificar'", [ahora(), compraId]);
      await t("UPDATE compras SET estado = 'rechazada' WHERE id = $1", [compraId]);
      await bitacora('compra rechazada', c.codigo, t);
    });
    return detalleCompra(compraId);
  }

  // Comprobante individual para el panel: la ruta se resuelve en la capa de almacenamiento.
  async function comprobanteDe(comprobanteId) {
    const c = await uno('SELECT * FROM comprobantes WHERE id = $1', [comprobanteId]);
    if (!c) throw new ErrorApp('Comprobante no encontrado.', 404);
    return c;
  }

  // ---------- Premios ----------
  function premioDTO(p) {
    return {
      id: p.id,
      ronda: p.ronda,
      premio: p.premio,
      monto: num(p.monto),
      serial: p.serial,
      pagado: Boolean(p.pagado),
      pagadoEn: p.pagado_en,
      ganador: p.compra_id
        ? { compraId: p.compra_id, codigo: p.codigo, nombre: p.nombre, cedula: p.cedula, telefono: p.telefono }
        : null,
    };
  }

  const SQL_PREMIOS = `
    SELECT p.*, c.id AS compra_id, c.codigo, c.nombre, c.cedula, c.telefono
    FROM premios p
    LEFT JOIN tablas t ON t.serial = p.serial
    LEFT JOIN compras c ON c.id = t.compra_id`;

  async function listarPremios() {
    return (await q(`${SQL_PREMIOS} ORDER BY p.id`)).map(premioDTO);
  }

  async function premioPorId(id) {
    const p = await uno(`${SQL_PREMIOS} WHERE p.id = $1`, [id]);
    if (!p) throw new ErrorApp('Premio no encontrado.', 404);
    return premioDTO(p);
  }

  async function crearPremio(datos) {
    const ronda = texto(datos.ronda, 'Nombre de la ronda', 80);
    const premio = texto(datos.premio, 'Premio', 120);
    const monto = redondear(datos.monto || 0);
    if (monto < 0) throw new ErrorApp('El monto del premio no puede ser negativo.');
    const [{ id }] = await q('INSERT INTO premios (ronda, premio, monto, creado_en) VALUES ($1, $2, $3, $4) RETURNING id', [ronda, premio, monto, ahora()]);
    await bitacora('ronda creada', `${ronda}: ${premio}`);
    return premioPorId(id);
  }

  // Solo una tabla vendida puede ser ganadora: así el premio siempre tiene un comprador real.
  async function asignarGanador(premioId, serialRaw) {
    const serial = String(serialRaw ?? '').trim().toUpperCase();
    const p = await uno('SELECT * FROM premios WHERE id = $1', [premioId]);
    if (!p) throw new ErrorApp('Premio no encontrado.', 404);
    const tabla = await uno('SELECT * FROM tablas WHERE serial = $1', [serial]);
    if (!tabla) throw new ErrorApp('Esa tabla no existe.', 404);
    if (tabla.estado !== 'vendida' || !tabla.compra_id) throw new ErrorApp('Esa tabla no está vendida.', 409);
    await q('UPDATE premios SET serial = $1 WHERE id = $2', [serial, premioId]);
    const compra = await uno('SELECT nombre FROM compras WHERE id = $1', [tabla.compra_id]);
    await bitacora('ganador', `${p.ronda}: ${serial} (${compra.nombre})`);
    return premioPorId(premioId);
  }

  async function quitarGanador(premioId) {
    await q('UPDATE premios SET serial = NULL WHERE id = $1 AND pagado = false', [premioId]);
    return premioPorId(premioId);
  }

  async function pagarPremio(premioId) {
    const p = await uno('SELECT * FROM premios WHERE id = $1', [premioId]);
    if (!p) throw new ErrorApp('Premio no encontrado.', 404);
    if (!p.serial) throw new ErrorApp('Primero registra la tabla ganadora.', 409);
    if (p.pagado) throw new ErrorApp('Este premio ya fue pagado.', 409);
    await q('UPDATE premios SET pagado = true, pagado_en = $1 WHERE id = $2', [ahora(), premioId]);
    await bitacora('premio pagado', `${p.ronda}: ${p.monto}`);
    return premioPorId(premioId);
  }

  // ---------- Gastos ----------
  async function listarGastos() {
    return (await q('SELECT * FROM gastos ORDER BY fecha DESC, id DESC')).map(g => ({
      id: g.id, fecha: g.fecha, concepto: g.concepto, categoria: g.categoria, monto: num(g.monto),
    }));
  }

  async function crearGasto(datos) {
    const concepto = texto(datos.concepto, 'Concepto');
    const categoria = texto(datos.categoria || 'Otros', 'Categoría', 40);
    const monto = montoPositivo(datos.monto, 'El monto');
    const fecha = String(datos.fecha || ahora().slice(0, 10)).slice(0, 10);
    await q('INSERT INTO gastos (fecha, concepto, categoria, monto, creado_en) VALUES ($1, $2, $3, $4, $5)', [fecha, concepto, categoria, monto, ahora()]);
    await bitacora('gasto', `${concepto}: ${monto}`);
    return { ok: true };
  }

  async function eliminarGasto(id) {
    const g = await uno('SELECT * FROM gastos WHERE id = $1', [id]);
    if (!g) throw new ErrorApp('Gasto no encontrado.', 404);
    await q('DELETE FROM gastos WHERE id = $1', [id]);
    await bitacora('gasto eliminado', `${g.concepto}: ${g.monto}`);
    return { ok: true };
  }

  // ---------- Resumen y reportes ----------
  async function resumen() {
    const compras = (await q(`${SQL_COMPRAS} WHERE c.estado != 'rechazada'`)).map(compraDTO);
    const suma = async sql => redondear(num((await q(sql))[0].n));
    const cobrado = await suma("SELECT COALESCE(SUM(monto_verificado), 0) AS n FROM pagos WHERE estado = 'verificado'");
    const porVerificar = await suma("SELECT COALESCE(SUM(monto_reportado), 0) AS n FROM pagos WHERE estado = 'por_verificar'");
    const premiosPagados = await suma('SELECT COALESCE(SUM(monto), 0) AS n FROM premios WHERE pagado = true');
    const premiosProgramados = await suma('SELECT COALESCE(SUM(monto), 0) AS n FROM premios');
    const gastos = await suma('SELECT COALESCE(SUM(monto), 0) AS n FROM gastos');
    const porCobrar = redondear(compras.reduce((s, c) => s + c.saldo, 0));
    // Dinero recibido por encima de las tablas: donado (suma a ingresos), por devolver (no es de la organización) o ya devuelto.
    const sobranteEn = estados => suma(`SELECT COALESCE(SUM(sobrante_monto), 0) AS n FROM compras WHERE sobrante_estado IN (${estados})`);
    const donaciones = await sobranteEn("'donado'");
    const porDevolver = await sobranteEn("'por_devolver','por_definir'");
    const devuelto = await sobranteEn("'devuelto'");
    const porMetodo = (await q(
      "SELECT metodo, SUM(monto_verificado) AS monto FROM pagos WHERE estado = 'verificado' GROUP BY metodo ORDER BY monto DESC",
    )).map(r => ({ metodo: r.metodo, monto: redondear(r.monto) }));

    const disponibles = await tablasDisponibles();
    const vendidas = num((await q("SELECT COUNT(*) AS n FROM tablas WHERE estado = 'vendida'"))[0].n);
    const cantidadEn = async estado => num((await q(
      'SELECT COALESCE(SUM(COALESCE(tablas_aprobadas, cantidad)), 0) AS n FROM compras WHERE estado = $1', [estado]))[0].n);

    return {
      dinero: {
        cobrado, porVerificar, porCobrar, premiosPagados, premiosProgramados, gastos,
        donaciones, porDevolver, devuelto,
        // Ventas + donaciones reales: lo cobrado menos lo que hay que devolver o ya se devolvió.
        ingresos: redondear(cobrado - porDevolver - devuelto),
        balance: redondear(cobrado - premiosPagados - gastos - devuelto),
        porMetodo,
      },
      tablas: {
        total: disponibles + vendidas,
        disponibles,
        vendidas,
        libresParaVender: await tablasLibresParaVender(),
        porEnviar: await cantidadEn('verificada'),
        entregadas: await cantidadEn('enviada'),
      },
      compras: {
        porVerificar: compras.filter(c => c.estado === 'por_verificar').length,
        listasParaEnviar: compras.filter(c => c.estado === 'verificada').length,
        conDeuda: compras.filter(c => c.saldo > 0).length,
      },
      evento: await evento({ conQr: false }),
    };
  }

  async function bitacoraLista(limite = 100) {
    return q('SELECT * FROM bitacora ORDER BY id DESC LIMIT $1', [limite]);
  }

  async function reporte(nombre) {
    if (nombre === 'compras') {
      const filas = (await q(`${SQL_COMPRAS} ORDER BY c.id`)).map(compraDTO);
      return {
        encabezados: ['Código', 'Fecha', 'Nombre', 'Celular', 'Ciudad', 'Referido por', 'Cédula', 'Correo', 'Tablas pedidas', 'Tablas enviadas', 'Total', 'Pagado', 'Saldo', 'Estado', 'WhatsApp', 'Correo envío', 'Entrega física', 'Seriales'],
        filas: filas.map(c => [c.codigo, c.creadaEn.slice(0, 10), c.nombre, c.telefono, c.ciudad, c.referidoPor, c.cedula, c.correo, c.cantidad, c.tablasAprobadas ?? '', c.total, c.pagado, c.saldo, c.estado, c.whatsappEstado, c.correoEstado, c.fisicaEstado, c.tablas.join(' ')]),
      };
    }
    if (nombre === 'sobrantes') {
      const filas = await listarSobrantes();
      return {
        encabezados: ['Código', 'Nombre', 'Celular', 'Pagado', 'Tablas enviadas', 'Sobrante', 'Eligió', 'Estado', 'Nota del comprador', 'Cómo se devolvió'],
        filas: filas.map(c => [c.codigo, c.nombre, c.telefono, c.pagado, c.tablasAprobadas ?? '', c.sobranteMonto, c.sobranteDestino || 'sin elegir', c.sobranteEstado, c.sobranteNota, c.sobranteResolucion ?? '']),
      };
    }
    if (nombre === 'deudas') {
      const filas = (await q(`${SQL_COMPRAS} WHERE c.estado != 'rechazada' ORDER BY c.id`)).map(compraDTO).filter(c => c.saldo > 0);
      return {
        encabezados: ['Código', 'Nombre', 'Cédula', 'Teléfono', 'Total', 'Pagado', 'Debe'],
        filas: filas.map(c => [c.codigo, c.nombre, c.cedula, c.telefono, c.total, c.pagado, c.saldo]),
      };
    }
    if (nombre === 'pagos') {
      const filas = await q('SELECT p.*, c.codigo, c.nombre FROM pagos p JOIN compras c ON c.id = p.compra_id ORDER BY p.id');
      return {
        encabezados: ['Fecha', 'Código', 'Nombre', 'Monto reportado', 'Monto verificado', 'Método', 'Referencia', 'Estado'],
        filas: filas.map(p => [p.creado_en.slice(0, 10), p.codigo, p.nombre, num(p.monto_reportado), p.monto_verificado == null ? '' : num(p.monto_verificado), p.metodo, p.referencia, p.estado]),
      };
    }
    if (nombre === 'tablas') {
      const filas = await q(`SELECT t.serial, t.estado, t.vendida_en, c.codigo, c.nombre, c.cedula, c.telefono
        FROM tablas t LEFT JOIN compras c ON c.id = t.compra_id ORDER BY t.serial`);
      return {
        encabezados: ['Serial', 'Estado', 'Vendida en', 'Código compra', 'Nombre', 'Cédula', 'Teléfono'],
        filas: filas.map(t => [t.serial, t.estado, t.vendida_en ?? '', t.codigo ?? '', t.nombre ?? '', t.cedula ?? '', t.telefono ?? '']),
      };
    }
    if (nombre === 'premios') {
      return {
        encabezados: ['Ronda', 'Premio', 'Monto', 'Serial', 'Ganador', 'Cédula', 'Teléfono', 'Pagado'],
        filas: (await listarPremios()).map(p => [p.ronda, p.premio, p.monto, p.serial ?? '', p.ganador?.nombre ?? '', p.ganador?.cedula ?? '', p.ganador?.telefono ?? '', p.pagado ? 'sí' : 'no']),
      };
    }
    if (nombre === 'gastos') {
      return {
        encabezados: ['Fecha', 'Concepto', 'Categoría', 'Monto'],
        filas: (await listarGastos()).map(g => [g.fecha, g.concepto, g.categoria, g.monto]),
      };
    }
    throw new ErrorApp('Reporte no existe.', 404);
  }

  return {
    evento, actualizarEvento,
    tablasDisponibles, tablasLibresParaVender, generarTablas, importarTablas, listarTablas,
    crearCompra, estadoPublico, detalleCompra, listarCompras,
    registrarPagoManual, verificarPago, rechazarPago,
    enviarTablas, reenviar, enlaceWhatsapp, enlaceCorreo, marcarEnviadoManual, entregaFisica, entregaPublica, rechazarCompra,
    gestionarSobrante, listarSobrantes, datosSelloEntrega,
    comprobanteDe,
    listarPremios, crearPremio, asignarGanador, quitarGanador, pagarPremio,
    listarGastos, crearGasto, eliminarGasto,
    resumen, bitacoraLista, reporte,
  };
}

module.exports = { crearServicios, ErrorApp, redondear };
