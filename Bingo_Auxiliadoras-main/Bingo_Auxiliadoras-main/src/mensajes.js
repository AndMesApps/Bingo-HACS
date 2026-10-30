// Mensaje que recibe cada benefactor con sus tablas (WhatsApp manual y correo). Un solo texto para los dos canales.
// Datos que se completan solos: saludo según la hora, nombre, fecha del bingo, cantidad y números de tabla,
// enlace privado de las tablas, código de la compra y enlace de conexión a la reunión (si está configurado).

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// '2026-05-24' -> 'domingo 24 de mayo del 2026' ('' si no hay una fecha válida).
function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(Number(m[1]), mes - 1, dia, 12));
  if (mes < 1 || mes > 12 || d.getUTCDate() !== dia) return '';
  return `${DIAS[d.getUTCDay()]} ${dia} de ${MESES[mes - 1]} del ${m[1]}`;
}

// Hora de Colombia (UTC-5, sin horario de verano): antes de mediodía, hasta las 6:59 p. m. y después.
function saludoDe(ahora = new Date()) {
  const h = (ahora.getUTCHours() + 19) % 24;
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

// 'TERESITA PÉREZ' -> 'Teresita'
function primerNombre(nombre) {
  const p = String(nombre ?? '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : '';
}

// ['12'] -> '12'; ['12','87'] -> '12 y 87'; ['1','2','3'] -> '1, 2 y 3'
function lista(valores) {
  const v = valores.map(String);
  return v.length <= 1 ? v.join('') : `${v.slice(0, -1).join(', ')} y ${v[v.length - 1]}`;
}

const ASUNTO = '¡Tus tablas de bingo!';

// Devuelve las partes del mensaje; cada canal las arma a su manera (texto de WhatsApp, texto y HTML de correo).
function partesDelMensaje({ nombre, seriales = [], enlace, codigo, fechaSorteo, enlaceConexion, ahora } = {}) {
  const fecha = fechaLarga(fechaSorteo);
  const cantidad = seriales.length;
  const conexion = String(enlaceConexion ?? '').trim();
  return {
    asunto: ASUNTO,
    saludo: `${saludoDe(ahora)} ${primerNombre(nombre)}, esperando estén super bien.`.replace(/ ,/, ','),
    titulo: ASUNTO,
    intro: `Agradecemos su participación en el Bingo de las Hermanas Auxiliadoras de Cristo Sacerdote${fecha ? `, a realizarse el ${fecha}` : ''}.`,
    presentacion: 'A continuación le anexamos información que le puede servir para tener un buen juego:',
    puntos: [
      'Las tablas están enumeradas en la parte superior, en el óvalo dorado que dice «TABLA N° …», debajo del logo. Por fa tenga el número ubicado porque es importante en el juego.',
      'Cada tabla va marcada con su nombre: en la franja azul de abajo, donde dice «Válida únicamente para …», y como marca de agua en toda la tabla. Es solo para usted y no se puede transferir.',
      'Le recomendamos tener sus tablas impresas o hacerlas a mano antes del bingo para que sea fácil jugar tapando con papelitos que previamente se tengan preparados.',
      `${conexion ? `Anexo enlace para conexión: ${conexion}.` : 'El enlace para conexión se lo enviaremos antes del bingo.'} No es requerido que tenga cámara abierta; es importante que tenga facilidad para escribir por el chat de la reunión, para cantar bingo, si corresponde.`,
    ],
    anexo: cantidad ? `Anexo: ${cantidad} ${cantidad === 1 ? 'tabla' : 'tablas'} (N° ${lista(seriales)}).` : '',
    descarga: enlace ? `Descárguelas aquí: ${enlace}` : '',
    codigo: codigo ? `Código de su compra: ${codigo} (guárdelo para consultar el estado).` : '',
    cierre: 'Gracias, feliz día.',
  };
}

// Texto para WhatsApp: el título va en negrita y la lista con viñetas (así ningún asterisco se confunde con formato).
function textoWhatsApp(datos) {
  const p = partesDelMensaje(datos);
  return [
    p.saludo, '', `*${p.titulo}*`, '', p.intro, '', p.presentacion,
    ...p.puntos.map(x => `• ${x}`), '',
    [p.anexo, p.descarga, p.codigo].filter(Boolean).join('\n'), '', p.cierre,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Convierte las direcciones web del texto en enlaces.
const conEnlaces = s => esc(s).replace(/(https?:\/\/[^\s<]+?)(?=[.,;]?(?:\s|$))/g, '<a href="$1">$1</a>');

function mensajeCorreo(datos) {
  const p = partesDelMensaje(datos);
  const texto = [
    p.saludo, '', p.titulo, '', p.intro, '', p.presentacion,
    ...p.puntos.map(x => `• ${x}`), '',
    [p.anexo, p.descarga, p.codigo].filter(Boolean).join('\n'), '', p.cierre,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  const html = `<p>${esc(p.saludo)}</p><h2 style="margin:0 0 8px">${esc(p.titulo)}</h2><p>${esc(p.intro)}</p><p>${esc(p.presentacion)}</p>`
    + `<ul>${p.puntos.map(x => `<li>${conEnlaces(x)}</li>`).join('')}</ul>`
    + [p.anexo, p.descarga, p.codigo].filter(Boolean).map(x => `<p>${conEnlaces(x)}</p>`).join('')
    + `<p>${esc(p.cierre)}</p>`;
  return { asunto: p.asunto, texto, html };
}

module.exports = { fechaLarga, saludoDe, primerNombre, lista, partesDelMensaje, textoWhatsApp, mensajeCorreo, ASUNTO };
