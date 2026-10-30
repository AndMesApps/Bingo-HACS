const crypto = require('node:crypto');
const { crearCorreo } = require('./correo');
const { FIGURAS, FIGURA_POR_DEFECTO, evaluarTabla } = require('./figuras');
const { limpiarConexion } = require('./mensajes');

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_TABLAS_POR_COMPRA = 50;
const MAX_TABLAS_LOTE = 500;
const MAX_PAGOS_EXTRA = 4;
const LOCK_VENTAS = 7001;
const LOCK_TABLAS = 7002;
// Bingo activo, y "el indicado o, si no se indica ninguno, el activo" para consultar un Bingo del histórico.
const ACTIVO = "(SELECT id FROM bingos WHERE estado = 'activo')";
const DE_BINGO = n => `COALESCE($${n}::int, ${ACTIVO})`;

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
    (SELECT string_agg(DISTINCT p.metodo, ', ') FROM pagos p WHERE p.compra_id = c.id AND p.estado <> 'rechazado') AS metodos,
    (SELECT MAX(p.fecha_pago) FROM pagos p WHERE p.compra_id = c.id AND p.estado <> 'rechazado') AS fecha_pago,
    COALESCE((SELECT array_agg(x.serial ORDER BY x.serial) FROM (
      SELECT t.serial FROM tablas t WHERE t.compra_id = c.id
      UNION ALL SELECT h.serial FROM tablas_historial h WHERE h.compra_id = c.id) x), '{}') AS tablas
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

  // Las tablas de una compra: las vendidas del Bingo activo o, si ya se cerró, las guardadas en el histórico.
  const serialesDe = async (compraId, t = q) => (await t(
    'SELECT serial FROM tablas WHERE compra_id = $1 UNION SELECT serial FROM tablas_historial WHERE compra_id = $1', [compraId],
  )).map(r => r.serial).sort(porSerial);

  async function exigirActivo(bingoId, que) {
    const [{ id }] = await q("SELECT id FROM bingos WHERE estado = 'activo'");
    if (bingoId !== id) throw new ErrorApp(`${que} pertenece a un Bingo cerrado y no se puede modificar.`, 409);
  }

  // ---------- Evento ----------
  // conQr=false deja fuera la imagen del QR (pesa) y solo avisa si existe; el panel la pide aparte al editar.
  const eventoDeFila = (e, conQr = true) => {
    return {
      nombre: e.nombre,
      precioTabla: num(e.precio_tabla),
      moneda: e.moneda,
      fechaSorteo: e.fecha_sorteo,
      enlaceConexion: e.enlace_conexion ?? '',
      cuentasPago: e.cuentas_pago,
      exigirPagoCompleto: Boolean(e.exigir_pago_completo),
      envioAutomatico: Boolean(e.envio_automatico),
      banco: e.banco ?? '',
      tipoCuenta: e.tipo_cuenta ?? '',
      numeroCuenta: e.numero_cuenta ?? '',
      titularCuenta: e.titular_cuenta ?? '',
      llavePago: e.llave_pago ?? '',
      tieneQr: Boolean(e.qr_pago),
      // 'predeterminada' (la de la app), 'propia' (subida para este Bingo) o 'ninguna'.
      textoInvitacion: e.texto_invitacion ?? '',
      pieza: e.pieza_invitacion == null ? 'predeterminada' : e.pieza_invitacion === '' ? 'ninguna' : 'propia',
      ...(conQr ? { qrPago: e.qr_pago ?? '' } : {}),
    };
  };
  async function evento({ conQr = true } = {}) {
    return eventoDeFila(await uno('SELECT * FROM evento WHERE id = 1'), conQr);
  }

  const QR_VALIDO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const QR_MAX_CARACTERES = 600000; // ~450 KB de imagen

  const PIEZA_VALIDA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const PIEZA_MAX_CARACTERES = 1500000; // ~1.1 MB de imagen

  // La imagen que acompaña al enlace de invitación: { origen, tipo, buffer } (sin tipo ni buffer si no hay propia).
  async function piezaInvitacion() {
    const v = (await uno('SELECT * FROM evento WHERE id = 1')).pieza_invitacion;
    if (v == null) return { origen: 'predeterminada' };
    if (v === '') return { origen: 'ninguna' };
    const m = v.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    return { origen: 'propia', tipo: m[1], buffer: Buffer.from(m[2], 'base64') };
  }

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
      enlaceConexion: limpiarConexion(datos.enlaceConexion ?? actual.enlaceConexion),
      cuentasPago: String(datos.cuentasPago ?? actual.cuentasPago).slice(0, 2000),
      exigirPagoCompleto: datos.exigirPagoCompleto === undefined ? actual.exigirPagoCompleto : Boolean(datos.exigirPagoCompleto),
      envioAutomatico: datos.envioAutomatico === undefined ? actual.envioAutomatico : Boolean(datos.envioAutomatico),
      banco: String(datos.banco ?? actual.banco).trim().slice(0, 80),
      tipoCuenta,
      numeroCuenta: String(datos.numeroCuenta ?? actual.numeroCuenta).trim().slice(0, 40),
      titularCuenta: String(datos.titularCuenta ?? actual.titularCuenta).trim().slice(0, 120),
      llavePago: String(datos.llavePago ?? actual.llavePago).trim().slice(0, 80),
      qrPago,
    };
    if (!(nuevo.precioTabla >= 0)) throw new ErrorApp('El precio no puede ser negativo.');
    if (nuevo.enlaceConexion && !/https?:\/\/\S+/i.test(nuevo.enlaceConexion)) throw new ErrorApp('Los datos de conexión deben incluir el enlace de la reunión (que empieza por http:// o https://).');
    if (nuevo.enlaceConexion.length > 600) throw new ErrorApp('Los datos de conexión son demasiado largos: deja solo el enlace, el ID y la hora (toca «Dejar solo lo necesario»).');
    const textoInvitacion = datos.textoInvitacion === undefined ? undefined : String(datos.textoInvitacion).trim();
    if (textoInvitacion && textoInvitacion.length > 1500) throw new ErrorApp('El texto de la invitación es demasiado largo (máximo 1500 caracteres).');
    // undefined conserva la pieza actual; una cadena vacía deja al Bingo sin imagen de invitación.
    const pieza = datos.piezaInvitacion === undefined ? undefined : String(datos.piezaInvitacion);
    if (pieza && (pieza.length > PIEZA_MAX_CARACTERES || !PIEZA_VALIDA.test(pieza))) {
      throw new ErrorApp('La pieza de invitación debe ser una imagen PNG, JPG o WEBP de máximo 1 MB.');
    }
    await q('UPDATE evento SET envio_automatico = $1, enlace_conexion = $2 WHERE id = 1', [nuevo.envioAutomatico, nuevo.enlaceConexion]);
    await q(
      `UPDATE evento SET nombre=$1, precio_tabla=$2, moneda=$3, fecha_sorteo=$4, cuentas_pago=$5, exigir_pago_completo=$6,
         banco=$7, tipo_cuenta=$8, numero_cuenta=$9, titular_cuenta=$10, llave_pago=$11, qr_pago=$12 WHERE id = 1`,
      [nuevo.nombre, nuevo.precioTabla, nuevo.moneda, nuevo.fechaSorteo, nuevo.cuentasPago, nuevo.exigirPagoCompleto,
        nuevo.banco, nuevo.tipoCuenta, nuevo.numeroCuenta, nuevo.titularCuenta, nuevo.llavePago, nuevo.qrPago],
    );
    await q("UPDATE bingos SET nombre = $1 WHERE estado = 'activo'", [nuevo.nombre || 'Bingo']);
    if (pieza !== undefined) await q('UPDATE evento SET pieza_invitacion = $1 WHERE id = 1', [pieza]);
    if (textoInvitacion !== undefined) await q('UPDATE evento SET texto_invitacion = $1 WHERE id = 1', [textoInvitacion]);
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
      `SELECT COALESCE(SUM(cantidad), 0) AS n FROM compras WHERE estado IN ('por_verificar','verificada') AND bingo_id = ${ACTIVO}`,
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
    const filas = await q(`SELECT t.serial, t.estado, t.vendida_en, c.id AS compra_id, c.codigo AS compra_codigo,
        c.nombre AS compra_nombre, c.telefono AS compra_telefono
      FROM tablas t LEFT JOIN compras c ON c.id = t.compra_id`);
    return filas.sort((a, b) => porSerial(a.serial, b.serial)).map(t => ({
      serial: t.serial, estado: t.estado, vendidaEn: t.vendida_en,
      compraId: t.compra_id, compraCodigo: t.compra_codigo, compraNombre: t.compra_nombre, compraTelefono: t.compra_telefono,
    }));
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
      reportado: redondear(num(c.reportado)),
      metodos: c.metodos || '',
      fechaPago: c.fecha_pago || '',
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

  async function listarCompras({ estado, bingoId } = {}) {
    const filas = estado
      ? await q(`${SQL_COMPRAS} WHERE c.estado = $1 AND c.bingo_id = ${DE_BINGO(2)} ORDER BY c.id DESC`, [estado, bingoId ?? null])
      : await q(`${SQL_COMPRAS} WHERE c.bingo_id = ${DE_BINGO(1)} ORDER BY c.id DESC`, [bingoId ?? null]);
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
    const metodo = texto(datos.metodo, 'Método de pago', 40);
    const esEfectivo = /efectivo/i.test(metodo);
    const correoComprador = String(datos.correo ?? '').trim().slice(0, 120);
    if (correoComprador && !CORREO_VALIDO.test(correoComprador)) throw new ErrorApp('El correo no es válido.');
    const hoy = ahora().slice(0, 10);
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // El pago principal y los que el comprador agregó en el mismo formulario para completar el valor de una tabla.
    const extras = Array.isArray(datos.pagosExtra) ? datos.pagosExtra.slice(0, MAX_PAGOS_EXTRA) : [];
    const pagos = [{ monto: datos.montoPagado, fecha: datos.fechaPago, referencia: datos.referencia, comprobantes }, ...extras.map(x => ({
      monto: x?.montoPagado, fecha: x?.fechaPago, referencia: x?.referencia, comprobantes: Array.isArray(x?.comprobantes) ? x.comprobantes : [],
    }))].map((p, i) => {
      const en = i ? ` (pago ${i + 1})` : '';
      if (!esEfectivo && !p.comprobantes.length) throw new ErrorApp(`Adjunta el comprobante de la consignación${en}.`);
      const fechaPago = String(p.fecha || (esEfectivo ? hoy : '')).trim();
      if (!FECHA_ISO.test(fechaPago)) throw new ErrorApp(`Indica la fecha de la consignación${en}.`);
      if (fechaPago > manana) throw new ErrorApp(`La fecha del pago no puede ser futura${en}.`);
      return {
        monto: montoPositivo(p.monto, `El valor pagado${en}`),
        fechaPago,
        referencia: String(p.referencia ?? '').trim().slice(0, 60) || (esEfectivo ? 'Efectivo' : 'Sin referencia'),
        comprobantes: p.comprobantes,
      };
    });
    const montoPagado = redondear(pagos.reduce((s, p) => s + p.monto, 0));

    // Lo que sobra al pagar por encima de las tablas que cubre el valor (consignación o efectivo):
    // el comprador decide si lo dona o si se lo devolvemos, y en ese caso deja una nota de cómo.
    const cubiertas = tablasPorMonto(montoPagado, e.precioTabla);
    // Quien paga puede decidir donar todo sin tablas (cantidad 0), tenga o no derecho a alguna. Si lo pagado no alcanza
    // para una tabla, solo se acepta como donación; para comprar debe completarlo con otro pago en el mismo formulario.
    const donarSinTablas = datos.donarSinTablas === true || datos.donarSinTablas === 'si'
      || (cubiertas < 1 && String(datos.valorInsuficiente ?? '').trim() === 'donacion');
    const donacion = cubiertas < 1 || donarSinTablas;
    if (cubiertas < 1 && !donarSinTablas) {
      throw new ErrorApp(`El valor mínimo es ${e.precioTabla} (una tabla) y llevas ${montoPagado}. Agrega otro pago para completarlo o elige donar ese dinero.`);
    }
    const cantidad = donacion ? 0 : enteroPositivo(datos.cantidad, 'El número de tablas');
    if (cantidad > MAX_TABLAS_POR_COMPRA) throw new ErrorApp(`Máximo ${MAX_TABLAS_POR_COMPRA} tablas por compra.`);
    const d = {
      nombre: texto(datos.nombre, 'Nombre'),
      cedula: String(datos.cedula ?? '').trim().slice(0, 20),
      telefono: normalizarTelefono(datos.telefono, datos.paisCodigo),
      correo: correoComprador,
      ciudad: texto(datos.ciudad, 'Ciudad', 80),
      referidoPor: texto(datos.referidoPor, 'Quién le habló del bingo', 120),
      metodo,
    };
    const total = redondear(cantidad * e.precioTabla);
    const sobranteEstimado = donacion ? 0 : redondear(montoPagado - cubiertas * e.precioTabla);
    let sobranteDestino = donacion ? 'donacion' : '';
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
           sobrante_destino, sobrante_nota, estado, creada_en, bingo_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'por_verificar', $13, ${ACTIVO}) RETURNING id`,
        [codigo, d.nombre, d.cedula, d.telefono, d.correo, d.ciudad, d.referidoPor, cantidad, e.precioTabla, total,
          sobranteDestino, sobranteNota, ahora()],
      );
      for (const p of pagos) {
        const [{ id: pagoId }] = await t(
          `INSERT INTO pagos (compra_id, monto_reportado, metodo, referencia, fecha_pago, estado, creado_en)
           VALUES ($1, $2, $3, $4, $5, 'por_verificar', $6) RETURNING id`,
          [id, p.monto, d.metodo, p.referencia, p.fechaPago, ahora()],
        );
        for (const c of p.comprobantes) {
          await t('INSERT INTO comprobantes (pago_id, ruta, nombre, tipo) VALUES ($1, $2, $3, $4)',
            [pagoId, c.ruta, String(c.nombre).slice(0, 120), c.tipo]);
        }
      }
      await bitacora(donacion ? 'donación registrada' : 'compra registrada',
        `${codigo} · ${d.nombre} · ${donacion ? 'donación' : cantidad + ' tabla(s)'} · pagó ${montoPagado} en ${pagos.length} pago(s)`, t);
      return { id: Number(id), codigo, total, tablasSugeridas: cubiertas, sobrante: sobranteEstimado, sobranteDestino, donacion };
    });
  }

  function normalizarTelefono(texto, pais) {
    return whatsapp.normalizarTelefono(texto, pais);
  }

  async function estadoPublico(codigo) {
    const c = await uno('SELECT codigo, cantidad, tablas_aprobadas, total, estado FROM compras WHERE codigo = $1', [String(codigo || '').trim().toUpperCase()]);
    if (!c) throw new ErrorApp('No encontramos una compra con ese código.', 404);
    return { codigo: c.codigo, cantidad: c.tablas_aprobadas ?? c.cantidad, total: num(c.total), estado: c.estado };
  }

  // Con el primer pago verificado la compra queda lista para enviar. Una compra con cantidad 0 es una donación
  // (pagó menos que una tabla y decidió donarlo): no lleva tablas y queda donada por lo verificado.
  async function alVerificarPago(t, c) {
    if (c.cantidad === 0) {
      const pagado = await pagadoDe(c.id, t);
      await t(
        `UPDATE compras SET estado = 'donacion', verificada_en = COALESCE(verificada_en, $1::text), sobrante_monto = $2::numeric,
           sobrante_estado = 'donado', sobrante_en = $1::text WHERE id = $3`,
        [ahora(), pagado, c.id],
      );
    } else if (c.estado === 'por_verificar') {
      await t("UPDATE compras SET estado = 'verificada', verificada_en = $1 WHERE id = $2", [ahora(), c.id]);
    }
  }

  // Cambio de opinión: quien donó sin tablas decide recibirlas. La compra vuelve al flujo normal (por verificar, o lista
  // para enviar si el pago ya estaba verificado) con la cantidad que cubre su pago o la que indique quien administra.
  async function convertirDonacion(compraId, { cantidad } = {}) {
    await db.tx(async t => {
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_VENTAS]);
      const [c] = await t('SELECT * FROM compras WHERE id = $1 FOR UPDATE', [compraId]);
      if (!c) throw new ErrorApp('Compra no encontrada.', 404);
      if (c.cantidad !== 0 || !['por_verificar', 'donacion'].includes(c.estado)) {
        throw new ErrorApp('Esta compra no es una donación sin tablas.', 409);
      }
      const [{ id: activo }] = await t("SELECT id FROM bingos WHERE estado = 'activo'");
      if (c.bingo_id !== activo) throw new ErrorApp('Esta donación es de un Bingo cerrado: no se le pueden asignar tablas.', 409);
      const precio = num(c.precio_unitario);
      const monto = c.estado === 'donacion'
        ? await pagadoDe(compraId, t)
        : redondear(num((await t("SELECT COALESCE(SUM(monto_reportado), 0) AS n FROM pagos WHERE compra_id = $1 AND estado <> 'rechazado'", [compraId]))[0].n));
      const cubiertas = tablasPorMonto(monto, precio);
      if (cubiertas < 1) throw new ErrorApp(`El pago (${monto}) no alcanza para una tabla (${precio}).`, 409);
      const n = enteroPositivo(cantidad ?? cubiertas, 'La cantidad de tablas');
      if (n > MAX_TABLAS_POR_COMPRA) throw new ErrorApp(`Máximo ${MAX_TABLAS_POR_COMPRA} tablas por compra.`);
      if (n > cubiertas) throw new ErrorApp(`El pago cubre solo ${cubiertas} tabla(s) a ${precio}.`, 409);
      if (n > await tablasLibresParaVender(t)) throw new ErrorApp('No hay suficientes tablas disponibles para esta cantidad.', 409);
      // Deja de ser donación: el sobrante (lo pagado por encima de las tablas) se define al enviar, como en cualquier compra.
      await t(
        `UPDATE compras SET cantidad = $1, total = $2::numeric, estado = $3::text, sobrante_destino = '', sobrante_nota = '',
           sobrante_monto = 0, sobrante_estado = 'ninguno', sobrante_en = NULL WHERE id = $4`,
        [n, redondear(n * precio), c.estado === 'donacion' ? 'verificada' : 'por_verificar', compraId],
      );
      await bitacora('donación cambiada a compra', `${c.codigo}: ${n} tabla(s)`, t);
    });
    return detalleCompra(compraId);
  }

  async function registrarPagoManual(compraId, datos, { baseUrl } = {}) {
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
      await alVerificarPago(t, c);
      await bitacora('pago registrado', `${c.codigo}: ${monto} (${metodo})`, t);
    });
    await enviarSiCorresponde(compraId, baseUrl);
    return detalleCompra(compraId);
  }

  async function verificarPago(pagoId, montoVerificado, { baseUrl } = {}) {
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
      await alVerificarPago(t, c);
      await bitacora('pago verificado', `${c.codigo}: ${monto} (${p.metodo} ${p.referencia})`, t);
    });
    await enviarSiCorresponde(c.id, baseUrl);
    return detalleCompra(c.id);
  }

  async function rechazarPago(pagoId, { baseUrl } = {}) {
    const p = await uno('SELECT * FROM pagos WHERE id = $1', [pagoId]);
    if (!p) throw new ErrorApp('Pago no encontrado.', 404);
    if (p.estado !== 'por_verificar') throw new ErrorApp('Este pago ya fue procesado.', 409);
    await q("UPDATE pagos SET estado = 'rechazado', verificado_en = $1 WHERE id = $2", [ahora(), pagoId]);
    const c = await uno('SELECT codigo FROM compras WHERE id = $1', [p.compra_id]);
    await bitacora('pago rechazado', `${c.codigo}: ${p.referencia}`);
    await enviarSiCorresponde(p.compra_id, baseUrl);
    return detalleCompra(p.compra_id);
  }

  async function pagadoDe(compraId, t = q) {
    return redondear(num((await t(
      "SELECT COALESCE(SUM(monto_verificado), 0) AS n FROM pagos WHERE compra_id = $1 AND estado = 'verificado'", [compraId],
    ))[0].n));
  }

  // Envío automático: al quedar resuelto el último pago de la compra se envían solas las tablas pedidas por WhatsApp y,
  // si dejó correo, también por correo. Solo actúa cuando no hay nada que decidir: ningún pago pendiente y lo verificado
  // cubre todas las tablas que pidió. Si no, la compra queda en "Listas para enviar" y quien verifica decide, como siempre.
  // Un fallo aquí nunca deshace la verificación del pago: queda en la bitácora y la compra sigue lista para envío manual.
  async function enviarSiCorresponde(compraId, baseUrl) {
    try {
      if (!(await evento({ conQr: false })).envioAutomatico) return;
      const c = await uno('SELECT * FROM compras WHERE id = $1', [compraId]);
      if (!c || c.estado !== 'verificada' || !(c.cantidad > 0)) return;
      const [{ n }] = await q("SELECT COUNT(*)::int AS n FROM pagos WHERE compra_id = $1 AND estado = 'por_verificar'", [compraId]);
      if (n > 0) return;
      const cubiertas = tablasPorMonto(await pagadoDe(compraId), num(c.precio_unitario));
      if (cubiertas < c.cantidad) {
        await bitacora('envío automático omitido', `${c.codigo}: el pago cubre ${cubiertas} de ${c.cantidad} tabla(s); decide quien verifica`);
        return;
      }
      await enviarTablas(compraId, { cantidad: c.cantidad, canales: { whatsapp: true, correo: Boolean(c.correo) }, baseUrl });
    } catch (err) {
      try { await bitacora('envío automático falló', `compra ${compraId}: ${err.message}`); } catch { /* sin registro */ }
    }
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
      const [{ id: activo }] = await t("SELECT id FROM bingos WHERE estado = 'activo'");
      if (c.bingo_id !== activo) throw new ErrorApp('Esta compra es de un Bingo cerrado: no se le pueden asignar tablas.', 409);

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
    const seriales = await serialesDe(compraId);
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

  // Datos del Bingo que completan el mensaje de las tablas (fecha y enlace de conexión a la reunión).
  async function extraMensaje() {
    const e = await evento({ conQr: false });
    return { fechaSorteo: e.fechaSorteo, enlaceConexion: e.enlaceConexion };
  }

  async function entregarWhatsApp(c, seriales, enlace) {
    try {
      const r = await whatsapp.enviarTablas({ telefono: c.telefono, nombre: c.nombre, seriales, enlace, codigo: c.codigo, extra: await extraMensaje() });
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
      const r = await correo.enviarTablas({ correo: c.correo, nombre: c.nombre, seriales, enlace, codigo: c.codigo, extra: await extraMensaje() });
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
    return whatsapp.enlaceManual(c.telefono, c.nombre, seriales, enlaceEntrega(baseUrl, c.token_entrega), c.codigo, await extraMensaje());
  }

  async function enlaceCorreo(compraId, baseUrl) {
    const { c, seriales } = await datosEntrega(compraId);
    if (!c.correo) throw new ErrorApp('Esta compra no tiene correo registrado.', 409);
    return correo.enlaceManual(c.correo, c.nombre, seriales, enlaceEntrega(baseUrl, c.token_entrega), c.codigo, await extraMensaje());
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
    const c = await uno(`SELECT c.id, c.nombre, b.nombre AS bingo FROM compras c JOIN bingos b ON b.id = c.bingo_id
      WHERE c.token_entrega = $1 AND c.estado = 'enviada'`, [token]);
    if (!c) throw new ErrorApp('Enlace no válido.', 404);
    return { nombre: c.nombre, evento: c.bingo, tablas: await serialesDe(c.id) };
  }

  // Datos con los que se sella cada imagen. Solo los usa la ruta de la imagen; nunca salen en el JSON público.
  async function datosSelloEntrega(token) {
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw new ErrorApp('Enlace no válido.', 404);
    const c = await uno("SELECT id, codigo, nombre, telefono FROM compras WHERE token_entrega = $1 AND estado = 'enviada'", [token]);
    if (!c) throw new ErrorApp('Enlace no válido.', 404);
    return { nombre: c.nombre, telefono: c.telefono, codigo: c.codigo, tablas: await serialesDe(c.id) };
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

  async function listarSobrantes(bingoId) {
    const filas = await q(`${SQL_COMPRAS} WHERE c.sobrante_monto > 0 AND c.bingo_id = ${DE_BINGO(1)}
      ORDER BY CASE c.sobrante_estado WHEN 'por_definir' THEN 0 WHEN 'por_devolver' THEN 1 ELSE 2 END, c.id DESC`, [bingoId ?? null]);
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
  // Un premio puede tener varias tablas ganadoras (empate): se reparte en partes iguales y cada ganadora recibe y firma
  // por separado. Si el premio es de una sola tabla, todo funciona como siempre.
  function repartoDe(monto, n) {
    if (n < 1) return [];
    const base = Math.floor((monto / n) * 100 + 1e-9) / 100;
    const partes = Array(n).fill(base);
    partes[0] = redondear(monto - base * (n - 1)); // el centavo que sobre queda en la primera
    return partes;
  }

  function ganadorDTO(g) {
    return {
      id: g.id, premioId: g.premio_id, serial: g.serial, monto: num(g.monto), entregado: Boolean(g.entregado), entregadoEn: g.entregado_en,
      recibidoPor: g.recibido_por ?? '', nota: g.entrega_nota ?? '',
      ganador: { compraId: g.compra_id, codigo: g.codigo, nombre: g.nombre, cedula: g.cedula, telefono: g.telefono },
    };
  }

  // estado: sin ganador · en revisión (ronda en juego) · por entregar · entrega parcial · entregado
  function premioDTO(p, ganadores = []) {
    const entregados = ganadores.filter(g => g.entregado).length;
    const estado = !ganadores.length ? 'sin ganador'
      : p.ronda_estado === 'en_juego' ? 'en revisión'
        : entregados === ganadores.length ? 'entregado' : entregados ? 'entrega parcial' : 'por entregar';
    return {
      id: p.id,
      ronda: p.ronda,
      premio: p.premio,
      monto: num(p.monto),
      figura: p.figura,
      figuraNombre: FIGURAS[p.figura]?.nombre ?? p.figura,
      rondaEstado: p.ronda_estado,
      ganadores,
      empate: ganadores.length > 1,
      estado,
      pagado: estado === 'entregado',
      serial: ganadores[0]?.serial ?? null,
    };
  }

  const SQL_GANADORES = `
    SELECT g.*, c.codigo, c.nombre, c.cedula, c.telefono
    FROM premio_ganadores g
    JOIN compras c ON c.id = g.compra_id`;

  async function listarPremios(bingoId) {
    const premios = await q(`SELECT * FROM premios p WHERE p.bingo_id = ${DE_BINGO(1)} ORDER BY p.id`, [bingoId ?? null]);
    const ganadores = (await q(`${SQL_GANADORES} JOIN premios p ON p.id = g.premio_id WHERE p.bingo_id = ${DE_BINGO(1)} ORDER BY g.id`, [bingoId ?? null])).map(ganadorDTO);
    return premios.map(p => premioDTO(p, ganadores.filter(g => g.premioId === p.id)));
  }

  async function premioPorId(id) {
    const p = await uno('SELECT * FROM premios WHERE id = $1', [id]);
    if (!p) throw new ErrorApp('Premio no encontrado.', 404);
    const ganadores = (await q(`${SQL_GANADORES} WHERE g.premio_id = $1 ORDER BY g.id`, [id])).map(ganadorDTO);
    return premioDTO(p, ganadores);
  }

  async function crearPremio(datos) {
    const ronda = texto(datos.ronda, 'Nombre de la ronda', 80);
    const premio = texto(datos.premio, 'Premio', 120);
    const monto = redondear(datos.monto || 0);
    if (monto < 0) throw new ErrorApp('El monto del premio no puede ser negativo.');
    const figura = datos.figura ?? FIGURA_POR_DEFECTO;
    if (!FIGURAS[figura]) throw new ErrorApp('Esa figura no existe.');
    const [{ id }] = await q(`INSERT INTO premios (ronda, premio, monto, figura, creado_en, bingo_id) VALUES ($1, $2, $3, $4, $5, ${ACTIVO}) RETURNING id`, [ronda, premio, monto, figura, ahora()]);
    await bitacora('ronda creada', `${ronda}: ${premio}`);
    return premioPorId(id);
  }

  const entregasDe = async premioId => num((await q('SELECT COUNT(*) AS n FROM premio_ganadores WHERE premio_id = $1 AND entregado = true', [premioId]))[0].n);

  // Reparte el premio en partes iguales entre las ganadoras actuales (solo mientras no se haya entregado nada).
  async function repartir(premioId) {
    const p = await uno('SELECT monto FROM premios WHERE id = $1', [premioId]);
    const ids = (await q('SELECT id FROM premio_ganadores WHERE premio_id = $1 ORDER BY id', [premioId])).map(r => r.id);
    const partes = repartoDe(num(p.monto), ids.length);
    for (let i = 0; i < ids.length; i++) await q('UPDATE premio_ganadores SET monto = $1 WHERE id = $2', [partes[i], ids[i]]);
  }

  // Agrega una tabla ganadora. Solo una tabla vendida puede ganar. En una ronda en juego debe cumplir la figura con las
  // balotas cantadas. Con { cerrar: false } la ronda sigue abierta para registrar más ganadoras (empate); por defecto
  // la ronda se cierra con esta ganadora.
  async function asignarGanador(premioId, serialRaw, { cerrar = true } = {}) {
    const serial = String(serialRaw ?? '').trim().toUpperCase();
    const p = await premioActivo(premioId);
    const tabla = await uno('SELECT * FROM tablas WHERE serial = $1', [serial]);
    if (!tabla) throw new ErrorApp('Esa tabla no existe.', 404);
    if (tabla.estado !== 'vendida' || !tabla.compra_id) throw new ErrorApp('Esa tabla no está vendida.', 409);
    if (await entregasDe(premioId) > 0) throw new ErrorApp('Ya se entregó parte de este premio: no se pueden agregar más ganadoras.', 409);
    if (p.ronda_estado === 'en_juego') {
      const r = await evaluarPremio(p, tabla);
      if (!r.cumple) throw new ErrorApp(`La tabla ${serial} no cumple la figura "${FIGURAS[p.figura].nombre}": le faltan ${r.faltan} balota(s).`, 409);
    }
    const nueva = await q('INSERT INTO premio_ganadores (premio_id, serial, compra_id, creado_en) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id', [premioId, serial, tabla.compra_id, ahora()]);
    if (!nueva.length) throw new ErrorApp(`La tabla ${serial} ya está registrada como ganadora de esta ronda.`, 409);
    await repartir(premioId);
    if (p.ronda_estado !== 'en_juego' || cerrar) await q("UPDATE premios SET ronda_estado = 'cerrada' WHERE id = $1", [premioId]);
    const compra = await uno('SELECT nombre FROM compras WHERE id = $1', [tabla.compra_id]);
    await bitacora('ganador', `${p.ronda}: ${serial} (${compra.nombre})`);
    return premioPorId(premioId);
  }

  // Termina la ronda en juego con las ganadoras ya registradas (una o varias) y deja el premio listo para entregar.
  async function cerrarRonda(premioId) {
    const p = await enJuego(premioId);
    const n = num((await q('SELECT COUNT(*) AS n FROM premio_ganadores WHERE premio_id = $1', [premioId]))[0].n);
    if (n < 1) throw new ErrorApp('Registra al menos una tabla ganadora antes de cerrar la ronda.', 409);
    await q("UPDATE premios SET ronda_estado = 'cerrada' WHERE id = $1", [premioId]);
    await bitacora('ronda cerrada', `${p.ronda}: ${n} ganadora(s)`);
    return premioPorId(premioId);
  }

  async function sinGanadoras(p) {
    const quedan = num((await q('SELECT COUNT(*) AS n FROM premio_ganadores WHERE premio_id = $1', [p.id]))[0].n);
    if (quedan === 0 && p.ronda_estado === 'cerrada') await q("UPDATE premios SET ronda_estado = 'pendiente' WHERE id = $1", [p.id]);
  }

  // Quita una ganadora (por ejemplo, la que se registró por error). No se puede si ya recibió su premio.
  async function quitarGanadora(ganadorId) {
    const g = await uno('SELECT * FROM premio_ganadores WHERE id = $1', [ganadorId]);
    if (!g) throw new ErrorApp('Ganadora no encontrada.', 404);
    const p = await premioActivo(g.premio_id);
    if (g.entregado) throw new ErrorApp('A esta ganadora ya se le entregó el premio: no se puede quitar.', 409);
    await q('DELETE FROM premio_ganadores WHERE id = $1', [ganadorId]);
    await repartir(p.id);
    await sinGanadoras(p);
    await bitacora('ganadora quitada', `${p.ronda}: ${g.serial}`);
    return premioPorId(p.id);
  }

  // Quita todas las ganadoras del premio (si todavía no se entregó nada).
  async function quitarGanador(premioId) {
    const p = await premioActivo(premioId);
    if (await entregasDe(premioId) === 0) {
      await q('DELETE FROM premio_ganadores WHERE premio_id = $1', [premioId]);
      await sinGanadoras(p);
    }
    return premioPorId(premioId);
  }

  // Entrega del premio a una ganadora: queda registrado quién lo recibió (nombre y documento) y una nota.
  async function entregarPremio(ganadorId, { recibidoPor, nota } = {}) {
    const g = await uno('SELECT * FROM premio_ganadores WHERE id = $1', [ganadorId]);
    if (!g) throw new ErrorApp('Ganadora no encontrada.', 404);
    const p = await premioActivo(g.premio_id);
    if (g.entregado) throw new ErrorApp('Este premio ya fue entregado.', 409);
    if (p.ronda_estado === 'en_juego') throw new ErrorApp('Cierra la ronda antes de entregar el premio.', 409);
    const quien = String(recibidoPor ?? '').trim().slice(0, 160);
    await q('UPDATE premio_ganadores SET entregado = true, entregado_en = $1, recibido_por = $2, entrega_nota = $3 WHERE id = $4',
      [ahora(), quien, String(nota ?? '').trim().slice(0, 500), ganadorId]);
    await bitacora('premio pagado', `${p.ronda}: ${num(g.monto)} (tabla ${g.serial}${quien ? `, recibió ${quien}` : ''})`);
    return premioPorId(p.id);
  }

  // Atajo para premios de una sola ganadora.
  async function pagarPremio(premioId, datos = {}) {
    const ganadores = await q('SELECT id, entregado FROM premio_ganadores WHERE premio_id = $1 ORDER BY id', [premioId]);
    if (!ganadores.length) throw new ErrorApp('Primero registra la tabla ganadora.', 409);
    if (ganadores.length > 1) throw new ErrorApp(`Hay ${ganadores.length} tablas ganadoras: entrega el premio a cada una.`, 409);
    if (ganadores[0].entregado) throw new ErrorApp('Este premio ya fue pagado.', 409);
    return entregarPremio(ganadores[0].id, datos);
  }

  // Una fila por tabla ganadora (en un empate el premio sale repartido); las rondas sin ganadora salen con el premio completo.
  function premiosPlanos(lista) {
    return lista.flatMap(x => (x.ganadores.length
      ? x.ganadores.map(g => ({
        ronda: x.empate ? `${x.ronda} (empate)` : x.ronda, premio: x.premio, figura: x.figuraNombre, monto: g.monto, serial: g.serial,
        ganador: g.ganador, estado: g.entregado ? 'entregado' : x.rondaEstado === 'en_juego' ? 'en revisión' : 'por entregar',
        recibidoPor: g.recibidoPor, nota: g.nota,
      }))
      : [{ ronda: x.ronda, premio: x.premio, figura: x.figuraNombre, monto: x.monto, serial: '', ganador: null, estado: 'sin ganador', recibidoPor: '', nota: '' }]));
  }

  // ---------- Sorteo en vivo ----------
  const numeroBalota = v => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 75) throw new ErrorApp('La balota debe ser un número del 1 al 75.');
    return n;
  };

  async function balotasDe(premioId) {
    return (await q('SELECT numero FROM balotas WHERE premio_id = $1 ORDER BY id', [premioId])).map(r => r.numero);
  }

  async function premioActivo(premioId) {
    const p = await uno('SELECT * FROM premios WHERE id = $1', [premioId]);
    if (!p) throw new ErrorApp('Premio no encontrado.', 404);
    await exigirActivo(p.bingo_id, 'Esta ronda');
    return p;
  }

  async function enJuego(premioId) {
    const p = await premioActivo(premioId);
    if (p.ronda_estado !== 'en_juego') throw new ErrorApp('Esta ronda no está en juego. Inicia la ronda primero.', 409);
    return p;
  }

  // Ronda en juego con sus balotas, para pintar el tablero. Sin ronda en juego devuelve ronda: null.
  async function estadoSorteo() {
    const p = await uno("SELECT * FROM premios WHERE ronda_estado = 'en_juego' AND bingo_id = " + ACTIVO);
    const figuras = Object.entries(FIGURAS).map(([id, f]) => ({ id, nombre: f.nombre }));
    if (!p) return { ronda: null, balotas: [], figuras };
    return { ronda: await premioPorId(p.id), balotas: await balotasDe(p.id), figuras };
  }

  async function iniciarRonda(premioId) {
    const p = await premioActivo(premioId);
    if (p.ronda_estado === 'cerrada') throw new ErrorApp('Esta ronda ya tiene ganador.', 409);
    const otra = await uno("SELECT ronda FROM premios WHERE ronda_estado = 'en_juego' AND id <> $1", [premioId]);
    if (otra) throw new ErrorApp(`La ronda "${otra.ronda}" sigue en juego. Páusala antes de iniciar otra.`, 409);
    await q("UPDATE premios SET ronda_estado = 'en_juego' WHERE id = $1", [premioId]);
    await bitacora('ronda iniciada', p.ronda);
    return estadoSorteo();
  }

  async function pausarRonda(premioId) {
    const p = await premioActivo(premioId);
    if (p.ronda_estado === 'en_juego') await q("UPDATE premios SET ronda_estado = 'pendiente' WHERE id = $1", [premioId]);
    await bitacora('ronda en pausa', p.ronda);
    return estadoSorteo();
  }

  async function cantarBalota(premioId, valor) {
    const numero = numeroBalota(valor);
    await enJuego(premioId);
    const r = await q('INSERT INTO balotas (premio_id, numero, cantada_en) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [premioId, numero, ahora()]);
    if (!r.length) throw new ErrorApp(`La balota ${numero} ya fue cantada en esta ronda.`, 409);
    return estadoSorteo();
  }

  async function deshacerBalota(premioId, valor) {
    const numero = numeroBalota(valor);
    await enJuego(premioId);
    await q('DELETE FROM balotas WHERE premio_id = $1 AND numero = $2', [premioId, numero]);
    return estadoSorteo();
  }

  async function evaluarPremio(p, tabla) {
    if (!tabla.numeros) throw new ErrorApp(`La tabla ${tabla.serial} no tiene sus números cargados: corre la migración del sorteo.`, 409);
    return evaluarTabla(p.figura, JSON.parse(tabla.numeros), await balotasDe(p.id));
  }

  // Cuando alguien canta "¡Bingo!": revisa la tabla contra las balotas de la ronda sin asignar nada.
  async function verificarTabla(premioId, serialRaw) {
    const p = await premioActivo(premioId);
    const serial = String(serialRaw ?? '').trim().toUpperCase();
    const tabla = await uno('SELECT * FROM tablas WHERE serial = $1', [serial]);
    if (!tabla) throw new ErrorApp('Esa tabla no existe.', 404);
    const compra = tabla.compra_id ? await uno('SELECT codigo, nombre, telefono FROM compras WHERE id = $1', [tabla.compra_id]) : null;
    const base = { serial, figura: p.figura, figuraNombre: FIGURAS[p.figura].nombre, comprador: compra };
    if (tabla.estado !== 'vendida' || !compra) return { ...base, cumple: false, motivo: 'Esa tabla no está vendida: no puede ganar.' };
    const r = await evaluarPremio(p, tabla);
    const yaRegistrada = (await q('SELECT 1 FROM premio_ganadores WHERE premio_id = $1 AND serial = $2', [premioId, serial])).length > 0;
    // En un empate de verdad todas las tablas se completan con la misma última balota. Si ya estaba completa antes,
    // se avisa (sin bloquear) para que quien dirige el sorteo decida si cantó a tiempo.
    const balotas = await balotasDe(premioId);
    const aTiempo = !r.cumple || balotas.length === 0 || !evaluarTabla(p.figura, JSON.parse(tabla.numeros), balotas.slice(0, -1)).cumple;
    const ganadoras = (await q('SELECT serial FROM premio_ganadores WHERE premio_id = $1 ORDER BY id', [premioId])).map(x => x.serial);
    const motivo = !r.cumple ? `No cumple: le faltan ${r.faltan} balota(s).`
      : yaRegistrada ? 'Cumple la figura, pero ya está registrada como ganadora de esta ronda.'
        : !aTiempo ? 'Cumple la figura, pero ya estaba completa antes de la última balota: revisa si cantó a tiempo.'
          : ganadoras.length ? 'Cumple la figura: sería un empate con las tablas ya registradas.' : 'Cumple la figura.';
    return { ...base, numeros: JSON.parse(tabla.numeros), marcadas: r.marcadas, faltan: r.faltan, cumple: r.cumple, yaRegistrada, aTiempo, ganadoras, motivo };
  }

  // ---------- Gastos ----------
  async function listarGastos(bingoId) {
    return (await q(`SELECT * FROM gastos WHERE bingo_id = ${DE_BINGO(1)} ORDER BY fecha DESC, id DESC`, [bingoId ?? null])).map(g => ({
      id: g.id, fecha: g.fecha, concepto: g.concepto, categoria: g.categoria, monto: num(g.monto),
    }));
  }

  async function crearGasto(datos) {
    const concepto = texto(datos.concepto, 'Concepto');
    const categoria = texto(datos.categoria || 'Otros', 'Categoría', 40);
    const monto = montoPositivo(datos.monto, 'El monto');
    const fecha = String(datos.fecha || ahora().slice(0, 10)).slice(0, 10);
    await q(`INSERT INTO gastos (fecha, concepto, categoria, monto, creado_en, bingo_id) VALUES ($1, $2, $3, $4, $5, ${ACTIVO})`, [fecha, concepto, categoria, monto, ahora()]);
    await bitacora('gasto', `${concepto}: ${monto}`);
    return { ok: true };
  }

  async function eliminarGasto(id) {
    const g = await uno('SELECT * FROM gastos WHERE id = $1', [id]);
    if (!g) throw new ErrorApp('Gasto no encontrado.', 404);
    await exigirActivo(g.bingo_id, 'Este gasto');
    await q('DELETE FROM gastos WHERE id = $1', [id]);
    await bitacora('gasto eliminado', `${g.concepto}: ${g.monto}`);
    return { ok: true };
  }

  // ---------- Resumen y reportes ----------
  // Dinero de un Bingo (el activo si no se indica). "ex" es el ejecutor: q, o t dentro de una transacción.
  async function dineroDe(bingoId, ex = q) {
    const p = [bingoId ?? null];
    const B = DE_BINGO(1);
    const filas = async sql => ex(sql, p);
    const suma = async sql => redondear(num((await filas(sql))[0].n));
    const compras = (await filas(`${SQL_COMPRAS} WHERE c.estado != 'rechazada' AND c.bingo_id = ${B}`)).map(compraDTO);
    const cobrado = await suma(`SELECT COALESCE(SUM(p.monto_verificado), 0) AS n FROM pagos p JOIN compras c ON c.id = p.compra_id
      WHERE p.estado = 'verificado' AND c.bingo_id = ${B}`);
    const porVerificar = await suma(`SELECT COALESCE(SUM(p.monto_reportado), 0) AS n FROM pagos p JOIN compras c ON c.id = p.compra_id
      WHERE p.estado = 'por_verificar' AND c.bingo_id = ${B}`);
    const premiosPagados = await suma(`SELECT COALESCE(SUM(g.monto), 0) AS n FROM premio_ganadores g JOIN premios p ON p.id = g.premio_id
      WHERE g.entregado = true AND p.bingo_id = ${B}`);
    const premiosProgramados = await suma(`SELECT COALESCE(SUM(monto), 0) AS n FROM premios WHERE bingo_id = ${B}`);
    const gastos = await suma(`SELECT COALESCE(SUM(monto), 0) AS n FROM gastos WHERE bingo_id = ${B}`);
    const porCobrar = redondear(compras.reduce((s, c) => s + c.saldo, 0));
    // Dinero recibido por encima de las tablas: donado (suma a ingresos), por devolver (no es de la organización) o ya devuelto.
    const sobranteEn = estados => suma(`SELECT COALESCE(SUM(sobrante_monto), 0) AS n FROM compras WHERE bingo_id = ${B} AND sobrante_estado IN (${estados})`);
    const donaciones = await sobranteEn("'donado'");
    const porDevolver = await sobranteEn("'por_devolver','por_definir'");
    const devuelto = await sobranteEn("'devuelto'");
    const porMetodo = (await filas(
      `SELECT p.metodo, SUM(p.monto_verificado) AS monto FROM pagos p JOIN compras c ON c.id = p.compra_id
       WHERE p.estado = 'verificado' AND c.bingo_id = ${B} GROUP BY p.metodo ORDER BY monto DESC`,
    )).map(r => ({ metodo: r.metodo, monto: redondear(r.monto) }));
    return {
      compras,
      dinero: {
        cobrado, porVerificar, porCobrar, premiosPagados, premiosProgramados, gastos,
        donaciones, porDevolver, devuelto,
        // Ventas + donaciones reales: lo cobrado menos lo que hay que devolver o ya se devolvió.
        ingresos: redondear(cobrado - porDevolver - devuelto),
        balance: redondear(cobrado - premiosPagados - gastos - devuelto),
        porMetodo,
      },
    };
  }

  async function resumen() {
    const { compras, dinero } = await dineroDe();
    const disponibles = await tablasDisponibles();
    const vendidas = num((await q("SELECT COUNT(*) AS n FROM tablas WHERE estado = 'vendida'"))[0].n);
    const cantidadEn = async estado => num((await q(
      `SELECT COALESCE(SUM(COALESCE(tablas_aprobadas, cantidad)), 0) AS n FROM compras WHERE estado = $1 AND bingo_id = ${ACTIVO}`, [estado]))[0].n);

    return {
      dinero,
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
        // Tablas ya asignadas cuyo WhatsApp falta por enviar desde el celular (o falló).
        whatsappPendientes: compras.filter(c => c.estado === 'enviada' && ['manual', 'fallido'].includes(c.whatsappEstado)).length,
      },
      evento: await evento({ conQr: false }),
    };
  }

  // ---------- Informes ----------
  // Un solo cálculo con todo lo que pide la administración: estado de resultados, caja por día y método, ventas por día,
  // por referido y por ciudad, gastos por categoría, premios, estado de pagos y control de entregas.
  // desde / hasta (AAAA-MM-DD, opcionales) acotan por la fecha propia de cada dato: fecha del pago, del envío, del gasto…
  async function informes({ bingoId, desde, hasta } = {}) {
    const fecha = (v, nombre) => {
      if (v == null || v === '') return null;
      if (!FECHA_ISO.test(String(v))) throw new ErrorApp(`La fecha "${nombre}" no es válida (usa AAAA-MM-DD).`);
      return String(v);
    };
    const d = fecha(desde, 'desde');
    const h = fecha(hasta, 'hasta');
    if (d && h && d > h) throw new ErrorApp('La fecha "desde" no puede ser posterior a "hasta".');
    const bingo = await uno(`SELECT * FROM bingos WHERE id = ${DE_BINGO(1)}`, [bingoId ? Number(bingoId) : null]);
    if (!bingo) throw new ErrorApp('Ese Bingo no existe.', 404);
    const p = [bingo.id, d, h];
    // Condición de rango sobre una columna de texto ISO (se compara solo la parte de la fecha).
    const R = col => `($2::text IS NULL OR substr(${col}, 1, 10) >= $2::text) AND ($3::text IS NULL OR substr(${col}, 1, 10) <= $3::text)`;
    const filas = sql => q(sql, p);
    // Consultas que no dependen del rango de fechas.
    const filasBingo = sql => q(sql, [bingo.id]);
    const total = async sql => redondear(num((await filas(sql))[0].n));

    // --- Estado de resultados ---
    const cobrado = await total(`SELECT COALESCE(SUM(p.monto_verificado), 0) AS n FROM pagos p JOIN compras c ON c.id = p.compra_id
      WHERE p.estado = 'verificado' AND c.bingo_id = $1 AND ${R('p.fecha_pago')}`);
    const sobranteEn = est => total(`SELECT COALESCE(SUM(sobrante_monto), 0) AS n FROM compras
      WHERE bingo_id = $1 AND sobrante_estado IN (${est}) AND ${R('sobrante_en')}`);
    const donaciones = await sobranteEn("'donado'");
    const porDevolver = await sobranteEn("'por_devolver','por_definir'");
    const devuelto = await sobranteEn("'devuelto'");
    const premiosPagados = await total(`SELECT COALESCE(SUM(g.monto), 0) AS n FROM premio_ganadores g JOIN premios p ON p.id = g.premio_id
      WHERE p.bingo_id = $1 AND g.entregado = true AND ${R('g.entregado_en')}`);
    const premiosPendientes = redondear(num((await filasBingo(`SELECT (SELECT COALESCE(SUM(monto), 0) FROM premios WHERE bingo_id = $1)
      - (SELECT COALESCE(SUM(g.monto), 0) FROM premio_ganadores g JOIN premios p ON p.id = g.premio_id WHERE p.bingo_id = $1 AND g.entregado = true) AS n`))[0].n));
    const gastos = await total(`SELECT COALESCE(SUM(monto), 0) AS n FROM gastos WHERE bingo_id = $1 AND ${R('fecha')}`);
    const ingresos = redondear(cobrado - porDevolver - devuelto);
    const resultados = {
      cobrado, porDevolver, devuelto, donaciones,
      ventasTablas: redondear(ingresos - donaciones),
      ingresos, premiosPagados, gastos,
      excedente: redondear(ingresos - premiosPagados - gastos),
      premiosPendientes,
      excedenteProyectado: redondear(ingresos - premiosPagados - gastos - premiosPendientes),
    };

    // --- Caja por día y método (pagos verificados, por fecha de pago) ---
    const cajaFilas = await filas(`SELECT p.fecha_pago AS dia, p.metodo, SUM(p.monto_verificado) AS monto, COUNT(*)::int AS pagos
      FROM pagos p JOIN compras c ON c.id = p.compra_id
      WHERE p.estado = 'verificado' AND c.bingo_id = $1 AND ${R('p.fecha_pago')} GROUP BY p.fecha_pago, p.metodo ORDER BY p.fecha_pago, p.metodo`);
    const metodos = [...new Set(cajaFilas.map(r => r.metodo))].sort();
    const dias = [...new Set(cajaFilas.map(r => r.dia))].sort();
    const caja = {
      metodos,
      dias: dias.map(dia => {
        const delDia = cajaFilas.filter(r => r.dia === dia);
        return { dia, porMetodo: Object.fromEntries(delDia.map(r => [r.metodo, redondear(r.monto)])), total: redondear(delDia.reduce((s, r) => s + num(r.monto), 0)), pagos: delDia.reduce((s, r) => s + r.pagos, 0) };
      }),
    };

    // --- Ventas: compras con tablas enviadas, por fecha de envío ---
    const enviada = `c.estado = 'enviada' AND c.bingo_id = $1 AND ${R('c.enviada_en')}`;
    const agrupado = async (expr, orden) => (await filas(
      `SELECT ${expr} AS clave, COUNT(*)::int AS compras, COALESCE(SUM(c.tablas_aprobadas), 0)::int AS tablas, COALESCE(SUM(c.total), 0) AS monto
       FROM compras c WHERE ${enviada} GROUP BY 1 ORDER BY ${orden}`,
    )).map(r => ({ clave: r.clave, compras: r.compras, tablas: r.tablas, monto: redondear(r.monto) }));
    const ventasPorDia = await agrupado('substr(c.enviada_en, 1, 10)', '1');
    const porReferido = await agrupado("COALESCE(NULLIF(TRIM(c.referido_por), ''), '(sin referido)')", '4 DESC, 1');
    const porCiudad = await agrupado("COALESCE(NULLIF(TRIM(c.ciudad), ''), '(sin ciudad)')", '4 DESC, 1');

    // --- Gastos por categoría ---
    const gastosPorCategoria = (await filas(`SELECT categoria AS clave, COUNT(*)::int AS cantidad, SUM(monto) AS monto
      FROM gastos WHERE bingo_id = $1 AND ${R('fecha')} GROUP BY categoria ORDER BY SUM(monto) DESC`))
      .map(r => ({ clave: r.clave, cantidad: r.cantidad, monto: redondear(r.monto) }));

    // --- Estado de los pagos ---
    const pagosEstado = (await filas(`SELECT p.estado AS clave, COUNT(*)::int AS cantidad, SUM(COALESCE(p.monto_verificado, p.monto_reportado)) AS monto
      FROM pagos p JOIN compras c ON c.id = p.compra_id WHERE c.bingo_id = $1 AND ${R('p.fecha_pago')} GROUP BY p.estado ORDER BY p.estado`))
      .map(r => ({ clave: r.clave, cantidad: r.cantidad, monto: redondear(r.monto) }));

    // --- Premios ---
    const premios = premiosPlanos(await listarPremios(bingoId)).map(x => ({
      ronda: x.ronda, premio: x.premio, monto: x.monto, figura: x.figura, ganador: x.ganador?.nombre ?? '',
      serial: x.serial, estado: x.estado, recibidoPor: x.recibidoPor,
    }));

    // --- Tablas y entregas (estado actual, no depende del rango) ---
    const vendidasHistorial = bingo.estado === 'activo'
      ? num((await q("SELECT COUNT(*) AS n FROM tablas WHERE estado = 'vendida'"))[0].n)
      : num((await q('SELECT COUNT(*) AS n FROM tablas_historial WHERE bingo_id = $1', [bingo.id]))[0].n);
    const canal = col => filasBingo(`SELECT ${col} AS clave, COUNT(*)::int AS cantidad FROM compras c
      WHERE c.estado = 'enviada' AND c.bingo_id = $1 GROUP BY 1 ORDER BY 1`).then(r => r.map(x => ({ clave: x.clave, cantidad: x.cantidad })));
    const tablas = {
      vendidas: vendidasHistorial,
      disponibles: bingo.estado === 'activo' ? await tablasDisponibles() : null,
      porEnviar: num((await filasBingo("SELECT COALESCE(SUM(COALESCE(tablas_aprobadas, cantidad)), 0) AS n FROM compras c WHERE c.estado = 'verificada' AND c.bingo_id = $1"))[0].n),
      whatsapp: await canal('c.whatsapp_estado'),
      correo: await canal('c.correo_estado'),
      fisica: await canal('c.fisica_estado'),
    };

    return { bingo: { id: bingo.id, nombre: bingo.nombre, estado: bingo.estado }, moneda: await monedaDe(bingo), desde: d, hasta: h, resultados, caja, ventasPorDia, porReferido, porCiudad, gastosPorCategoria, pagosEstado, premios, tablas };
  }

  // ---------- Varios bingos: histórico y reinicio ----------
  const sinQr = config => { const { qrPago, qr_pago, ...resto } = config || {}; return resto; };

  async function listarBingos() {
    const filas = await q('SELECT * FROM bingos ORDER BY id DESC');
    const dto = b => ({
      id: b.id, nombre: b.nombre, estado: b.estado, iniciadoEn: b.iniciado_en, cerradoEn: b.cerrado_en,
      config: b.config ? sinQr(JSON.parse(b.config)) : null,
      resumen: b.resumen ? JSON.parse(b.resumen) : null,
    });
    return { actual: dto(filas.find(b => b.estado === 'activo')), historico: filas.filter(b => b.estado === 'cerrado').map(dto) };
  }

  // Cierra el Bingo activo (queda en el histórico con su configuración y su resumen) y abre uno nuevo en cero:
  // las tablas vuelven a estar disponibles y los datos de invitación y de pago quedan vacíos para el nuevo Bingo.
  async function reiniciarBingo(datos = {}) {
    if (datos.confirmar !== true) throw new ErrorApp('Confirma que quieres cerrar este Bingo y empezar uno nuevo.');
    const nombre = texto(datos.nombre, 'El nombre del nuevo Bingo', 120);
    const r = await db.tx(async t => {
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_VENTAS]);
      await t('SELECT pg_advisory_xact_lock($1)', [LOCK_TABLAS]);
      const [b] = await t("SELECT * FROM bingos WHERE estado = 'activo' FOR UPDATE");
      const [{ n }] = await t(
        "SELECT COUNT(*)::int AS n FROM compras WHERE bingo_id = $1 AND estado IN ('por_verificar','verificada')", [b.id]);
      if (n) {
        throw new ErrorApp(`Hay ${n} compra(s) sin resolver (por verificar o verificadas sin enviar). Envíalas o recházalas antes de reiniciar.`, 409);
      }
      const [evento] = await t('SELECT * FROM evento WHERE id = 1');
      const { compras, dinero } = await dineroDe(b.id, t);
      const [{ vendidas }] = await t('SELECT COUNT(*)::int AS vendidas FROM tablas WHERE compra_id IS NOT NULL');
      const resumenCierre = {
        dinero, tablasVendidas: vendidas,
        compras: compras.length,
        donaciones: compras.filter(c => c.estado === 'donacion').length,
        tablasEntregadas: compras.reduce((s, c) => s + (c.estado === 'enviada' ? (c.tablasAprobadas ?? c.cantidad) : 0), 0),
      };

      await t(`INSERT INTO tablas_historial (bingo_id, serial, compra_id, vendida_en)
        SELECT $1, serial, compra_id, vendida_en FROM tablas WHERE compra_id IS NOT NULL`, [b.id]);
      // El trigger de control estricto solo permite liberar tablas vendidas dentro de esta transacción.
      await t("SELECT set_config('app.reinicio', '1', true)");
      await t("UPDATE tablas SET estado = 'disponible', compra_id = NULL, vendida_en = NULL WHERE compra_id IS NOT NULL");
      await t("UPDATE premios SET ronda_estado = 'cerrada' WHERE ronda_estado = 'en_juego'");
      await t("UPDATE bingos SET estado = 'cerrado', config = $2, resumen = $3, cerrado_en = $4 WHERE id = $1",
        [b.id, JSON.stringify(eventoDeFila(evento, false)), JSON.stringify(resumenCierre), ahora()]);
      const [nuevo] = await t("INSERT INTO bingos (nombre, iniciado_en) VALUES ($1, $2) RETURNING id", [nombre, ahora()]);
      // Invitación y pago propios de cada Bingo: el nuevo empieza vacío (precio 0 = compras cerradas hasta configurarlo).
      await t(
        `UPDATE evento SET nombre = $1, precio_tabla = 0, fecha_sorteo = '', cuentas_pago = '', exigir_pago_completo = true,
           banco = '', tipo_cuenta = '', numero_cuenta = '', titular_cuenta = '', llave_pago = '', qr_pago = '',
           pieza_invitacion = '', texto_invitacion = '', enlace_conexion = '' WHERE id = 1`, [nombre]);
      await bitacora('bingo reiniciado', `"${b.nombre}" pasó al histórico (${vendidas} tabla(s) vendidas). Nuevo Bingo: "${nombre}"`, t);
      return { cerrado: { id: b.id, nombre: b.nombre }, nuevo: { id: nuevo.id, nombre } };
    });
    return r;
  }

  async function bitacoraLista(limite = 100) {
    return q('SELECT * FROM bitacora ORDER BY id DESC LIMIT $1', [limite]);
  }

  // Moneda de un Bingo: la del evento si está activo; si está cerrado, la que quedó guardada al cerrarlo.
  async function monedaDe(bingo) {
    if (bingo.estado === 'activo') return (await evento({ conQr: false })).moneda;
    try { return JSON.parse(bingo.config || '{}').moneda ?? ''; } catch { return ''; }
  }

  async function reporte(nombre, bingoId) {
    const datos = await reporteSinContexto(nombre, bingoId);
    const bingo = await uno(`SELECT * FROM bingos WHERE id = ${DE_BINGO(1)}`, [bingoId ? Number(bingoId) : null]);
    return { ...datos, bingo: bingo.nombre, moneda: await monedaDe(bingo) };
  }

  async function reporteSinContexto(nombre, bingoId) {
    const bingo = await uno(`SELECT * FROM bingos WHERE id = ${DE_BINGO(1)}`, [bingoId ? Number(bingoId) : null]);
    if (!bingo) throw new ErrorApp('Ese Bingo no existe.', 404);
    const bid = bingo.id;
    if (nombre === 'compras') {
      const filas = (await q(`${SQL_COMPRAS} WHERE c.bingo_id = $1 ORDER BY c.id`, [bid])).map(compraDTO);
      return {
        encabezados: ['Código', 'Fecha', 'Nombre', 'Celular', 'Ciudad', 'Referido por', 'Cédula', 'Correo', 'Tablas pedidas', 'Tablas enviadas', 'Total', 'Pagado', 'Saldo', 'Estado', 'WhatsApp', 'Correo envío', 'Entrega física', 'Seriales'],
        filas: filas.map(c => [c.codigo, c.creadaEn.slice(0, 10), c.nombre, c.telefono, c.ciudad, c.referidoPor, c.cedula, c.correo, c.cantidad, c.tablasAprobadas ?? '', c.total, c.pagado, c.saldo, c.estado, c.whatsappEstado, c.correoEstado, c.fisicaEstado, c.tablas.join(' ')]),
      };
    }
    if (nombre === 'sobrantes') {
      const filas = await listarSobrantes(bid);
      return {
        encabezados: ['Código', 'Nombre', 'Celular', 'Pagado', 'Tablas enviadas', 'Sobrante', 'Eligió', 'Estado', 'Nota del comprador', 'Cómo se devolvió'],
        filas: filas.map(c => [c.codigo, c.nombre, c.telefono, c.pagado, c.tablasAprobadas ?? '', c.sobranteMonto, c.sobranteDestino || 'sin elegir', c.sobranteEstado, c.sobranteNota, c.sobranteResolucion ?? '']),
      };
    }
    if (nombre === 'deudas') {
      const filas = (await q(`${SQL_COMPRAS} WHERE c.estado != 'rechazada' AND c.bingo_id = $1 ORDER BY c.id`, [bid])).map(compraDTO).filter(c => c.saldo > 0);
      return {
        encabezados: ['Código', 'Nombre', 'Cédula', 'Teléfono', 'Total', 'Pagado', 'Debe'],
        filas: filas.map(c => [c.codigo, c.nombre, c.cedula, c.telefono, c.total, c.pagado, c.saldo]),
      };
    }
    if (nombre === 'pagos') {
      const filas = await q('SELECT p.*, c.codigo, c.nombre FROM pagos p JOIN compras c ON c.id = p.compra_id WHERE c.bingo_id = $1 ORDER BY p.id', [bid]);
      return {
        encabezados: ['Fecha', 'Código', 'Nombre', 'Monto reportado', 'Monto verificado', 'Método', 'Referencia', 'Estado'],
        filas: filas.map(p => [p.creado_en.slice(0, 10), p.codigo, p.nombre, num(p.monto_reportado), p.monto_verificado == null ? '' : num(p.monto_verificado), p.metodo, p.referencia, p.estado]),
      };
    }
    if (nombre === 'tablas') {
      // Del Bingo activo: todas las tablas; de uno cerrado: las que vendió, guardadas en el histórico.
      const filas = bingo.estado === 'activo'
        ? await q(`SELECT t.serial, t.estado, t.vendida_en, c.codigo, c.nombre, c.cedula, c.telefono
            FROM tablas t LEFT JOIN compras c ON c.id = t.compra_id ORDER BY t.serial`)
        : await q(`SELECT h.serial, 'vendida' AS estado, h.vendida_en, c.codigo, c.nombre, c.cedula, c.telefono
            FROM tablas_historial h JOIN compras c ON c.id = h.compra_id WHERE h.bingo_id = $1 ORDER BY h.serial`, [bid]);
      return {
        encabezados: ['Serial', 'Estado', 'Vendida en', 'Código compra', 'Nombre', 'Cédula', 'Teléfono'],
        filas: filas.map(t => [t.serial, t.estado, t.vendida_en ?? '', t.codigo ?? '', t.nombre ?? '', t.cedula ?? '', t.telefono ?? '']),
      };
    }
    if (nombre === 'premios') {
      return {
        encabezados: ['Ronda', 'Premio', 'Figura', 'Monto', 'Tabla ganadora', 'Ganador', 'Cédula', 'Teléfono', 'Entrega', 'Recibió', 'Nota'],
        filas: premiosPlanos(await listarPremios(bid)).map(p => [p.ronda, p.premio, p.figura, p.monto, p.serial, p.ganador?.nombre ?? '', p.ganador?.cedula ?? '', p.ganador?.telefono ?? '', p.estado, p.recibidoPor, p.nota])
      };
    }
    if (nombre === 'gastos') {
      return {
        encabezados: ['Fecha', 'Concepto', 'Categoría', 'Monto'],
        filas: (await listarGastos(bid)).map(g => [g.fecha, g.concepto, g.categoria, g.monto]),
      };
    }
    throw new ErrorApp('Reporte no existe.', 404);
  }

  return {
    evento, actualizarEvento, piezaInvitacion,
    tablasDisponibles, tablasLibresParaVender, generarTablas, importarTablas, listarTablas,
    crearCompra, estadoPublico, detalleCompra, listarCompras,
    registrarPagoManual, verificarPago, rechazarPago, convertirDonacion,
    enviarTablas, reenviar, enlaceWhatsapp, enlaceCorreo, marcarEnviadoManual, entregaFisica, entregaPublica, rechazarCompra,
    gestionarSobrante, listarSobrantes, datosSelloEntrega,
    comprobanteDe,
    listarPremios, crearPremio, asignarGanador, cerrarRonda, quitarGanadora, quitarGanador, entregarPremio, pagarPremio,
    estadoSorteo, iniciarRonda, pausarRonda, cantarBalota, deshacerBalota, verificarTabla,
    listarGastos, crearGasto, eliminarGasto,
    resumen, informes, bitacoraLista, reporte, listarBingos, reiniciarBingo,
  };
}

module.exports = { crearServicios, ErrorApp, redondear };
