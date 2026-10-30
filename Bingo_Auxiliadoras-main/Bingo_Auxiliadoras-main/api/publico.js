const { obtenerContexto } = require('../src/contexto');
const { enrutar, responderError } = require('../src/http');
const { ErrorApp } = require('../src/servicios');
const { sellarTabla } = require('../src/sello');
const { armarPdf } = require('../src/pdf');
const { PAISES } = require('../src/paises');
const fs = require('node:fs');
const path = require('node:path');

const TABLAS_POR_PDF = 20;

// Procesa la lista con a lo sumo "limite" tareas a la vez, conservando el orden.
async function conLimite(lista, limite, tarea) {
  const resultados = new Array(lista.length);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, async () => {
    while (siguiente < lista.length) {
      const i = siguiente++;
      resultados[i] = await tarea(lista[i], i);
    }
  }));
  return resultados;
}

// Rutas públicas: evento, subida de comprobantes, compra y consulta de estado.
module.exports = async (req, res) => {
  try {
    const { servicios, storage, imagenes, env } = obtenerContexto();
    const rutas = [
      {
        metodo: 'GET', patron: /^\/evento$/,
        handler: async (_p, _req, res) => {
          const e = await servicios.evento();
          res.status(200).json({
            nombre: e.nombre, precioTabla: e.precioTabla, moneda: e.moneda,
            fechaSorteo: e.fechaSorteo, cuentasPago: e.cuentasPago, abierto: e.precioTabla > 0,
            banco: e.banco, tipoCuenta: e.tipoCuenta, numeroCuenta: e.numeroCuenta,
            titularCuenta: e.titularCuenta, llavePago: e.llavePago, qrPago: e.qrPago,
            paises: PAISES, paisPorDefecto: env.CODIGO_PAIS || '57',
          });
        },
      },
      {
        // Imagen de invitación del Bingo: la que usa la vista previa del enlace (og:image) y el botón de compartir.
        metodo: 'GET', patron: /^\/invitacion(\.jpg)?$/,
        handler: async (_p, _req, res) => {
          const p = await servicios.piezaInvitacion();
          res.setHeader('Cache-Control', 'public, max-age=300');
          if (p.origen === 'propia') {
            res.setHeader('Content-Type', p.tipo);
            return res.status(200).send(p.buffer);
          }
          if (p.origen === 'predeterminada') {
            try {
              const archivo = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'pieza-invitacion.jpg'));
              res.setHeader('Content-Type', 'image/jpeg');
              return res.status(200).send(archivo);
            } catch {
              res.statusCode = 302;
              res.setHeader('Location', '/img/pieza-invitacion.jpg');
              return res.end();
            }
          }
          // Sin imagen: el enlace se comparte con el logo.
          res.statusCode = 302;
          res.setHeader('Location', '/img/logo-hacs.jpg');
          res.end();
        },
      },
      {
        // Emite el token para que el navegador suba el comprobante directo a Vercel Blob.
        metodo: 'POST', patron: /^\/comprobantes\/firmar$/,
        handler: async (_p, req, res) => res.status(200).json(await storage.generarToken(req, req.body)),
      },
      {
        metodo: 'POST', patron: /^\/compras$/,
        handler: async (_p, req, res) => {
          const cuerpo = req.body || {};
          // Cada pago (el principal y los extra del mismo formulario) trae hasta 3 comprobantes ya subidos a Blob.
          const validar = async lista => {
            const comprobantes = Array.isArray(lista) ? lista.slice(0, 3) : [];
            for (const c of comprobantes) {
              if (!storage.rutaValida(c?.ruta) || !(await storage.existe(c.ruta))) {
                throw new ErrorApp('Uno de los comprobantes no se subió correctamente. Vuelve a intentarlo.');
              }
              if (!storage.tipoPermitido(c.tipo)) throw new ErrorApp('Tipo de comprobante no permitido.');
            }
            return comprobantes;
          };
          const comprobantes = await validar(cuerpo.comprobantes);
          const pagosExtra = [];
          for (const x of Array.isArray(cuerpo.pagosExtra) ? cuerpo.pagosExtra.slice(0, 4) : []) {
            pagosExtra.push({ ...x, comprobantes: await validar(x?.comprobantes) });
          }
          const r = await servicios.crearCompra({ ...cuerpo, pagosExtra }, comprobantes);
          res.status(201).json(r);
        },
      },
      {
        metodo: 'GET', patron: /^\/compras\/([A-Za-z0-9-]+)$/,
        handler: async ([codigo], _req, res) => res.status(200).json(await servicios.estadoPublico(codigo)),
      },
      {
        // Página privada del comprador: solo con el token de su compra se ven sus tablas.
        metodo: 'GET', patron: /^\/entrega\/([A-Za-z0-9]+)$/,
        handler: async ([token], _req, res) => {
          const e = await servicios.entregaPublica(token);
          res.setHeader('Cache-Control', 'no-store');
          res.status(200).json({ ...e, imagenes: imagenes.configurado });
        },
      },
      {
        // PDF para imprimir: 4 tablas por hoja carta, hasta 20 tablas por archivo (?parte=N si son más).
        // Cada tabla va sellada con el nombre y el teléfono del comprador.
        metodo: 'GET', patron: /^\/entrega\/([A-Za-z0-9]+)\/pdf$/,
        handler: async ([token], req, res) => {
          const d = await servicios.datosSelloEntrega(token);
          if (!imagenes.configurado) throw new ErrorApp('Las imágenes de las tablas aún no están disponibles.', 404);
          const partes = Math.ceil(d.tablas.length / TABLAS_POR_PDF);
          const parte = Math.min(Math.max(parseInt(req.query?.parte, 10) || 1, 1), partes);
          const seriales = d.tablas.slice((parte - 1) * TABLAS_POR_PDF, parte * TABLAS_POR_PDF);
          const jpegs = await conLimite(seriales, 5, async serial => {
            const img = await imagenes.leer(serial);
            if (!img) throw new ErrorApp(`La imagen de la tabla ${serial} no está disponible.`, 404);
            // Menor resolución en el PDF para que pese menos (límite de 4,5 MB por respuesta en Vercel).
            return sellarTabla({ buffer: img.buffer, serial, nombre: d.nombre, telefono: d.telefono, codigo: d.codigo, escala: 0.8, calidad: 80 });
          });
          const pdf = await armarPdf(jpegs, { titulo: `Tablas del bingo - ${d.nombre}` });
          const sufijo = partes > 1 ? `-parte${parte}` : '';
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="Tablas-Bingo-${d.codigo}${sufijo}.pdf"`);
          res.setHeader('Cache-Control', 'private, no-store');
          res.status(200).send(Buffer.from(pdf));
        },
      },
      {
        // Imagen de UNA tabla; se entrega solo si pertenece a la compra del token.
        metodo: 'GET', patron: /^\/entrega\/([A-Za-z0-9]+)\/imagen\/([A-Za-z0-9._-]+)$/,
        // Nunca se entrega la imagen original: siempre sellada con nombre y teléfono del comprador.
        // Si el sello falla, la respuesta es un error (no se entrega la tabla sin sellar).
        handler: async ([token, serial], _req, res) => {
          const d = await servicios.datosSelloEntrega(token);
          if (!d.tablas.includes(serial)) throw new ErrorApp('Tabla no encontrada.', 404);
          const img = await imagenes.leer(serial);
          if (!img) throw new ErrorApp('La imagen de esta tabla no está disponible.', 404);
          const sellada = await sellarTabla({ buffer: img.buffer, serial, nombre: d.nombre, telefono: d.telefono, codigo: d.codigo });
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'private, max-age=3600');
          res.status(200).send(sellada);
        },
      },
    ];
    await enrutar(rutas, req, res);
  } catch (err) {
    responderError(res, err);
  }
};
