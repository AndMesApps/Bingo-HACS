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

// De una invitación completa de Zoom (o Meet/Teams) deja solo lo necesario para conectarse: enlace, ID, código y hora.
// Devuelve el texto en varias líneas, o '' si no encuentra ningún enlace.
function compactarInvitacion(texto) {
  const t = String(texto ?? '');
  const limpiar = u => u.replace(/[.,;)\]]+$/, '');
  const urls = (t.match(/https?:\/\/[^\s<>"]+/g) || []).map(limpiar);
  const principal = urls.find(u => /zoom\.us\/j\/\d+/i.test(u) && !/[?&]mynotes/i.test(u))
    || urls.find(u => /meet\.google\.com\/[a-z]/i.test(u))
    || urls.find(u => /teams\.(microsoft|live)\.com\/(l\/meetup-join|meet)/i.test(u))
    || urls[0];
  if (!principal) return '';
  const lineas = [principal];
  const id = /(?:ID de reuni[oó]n|Meeting ID)\s*:\s*([\d ]{6,})/i.exec(t);
  if (id) lineas.push(`ID de reunión: ${id[1].trim().replace(/\s+/g, ' ')}`);
  const clave = /(?:C[oó]digo de acceso|Passcode|Contrase[ñn]a)\s*:\s*(\S+)/i.exec(t);
  if (clave) lineas.push(`Código de acceso: ${clave[1]}`);
  const hora = /(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?(?:[ \t]+([A-Za-zÁÉÍÓÚáéíóúñÑ_]+))?/i.exec(t);
  if (hora) {
    const sufijo = hora[3].toLowerCase() === 'a' ? 'a. m.' : 'p. m.';
    const zona = hora[4] && !/^(del|de)$/i.test(hora[4]) ? ` (hora de ${hora[4].replace(/_/g, ' ')})` : '';
    lineas.push(`Hora: ${Number(hora[1])}:${hora[2]} ${sufijo}${zona}`);
  }
  return lineas.join('\n');
}

// Deja los datos de conexión en líneas limpias (sin espacios ni líneas vacías de más).
const limpiarConexion = t => String(t ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n');

// Un solo enlace va en la misma línea; con varios datos (enlace, ID, hora) cada uno va en su línea.
function conexionDe(conexion) {
  const aviso = 'No es requerido que tenga cámara abierta; es importante que tenga facilidad para escribir por el chat de la reunión, para cantar bingo, si corresponde.';
  if (!conexion) return `El enlace para conexión se lo enviaremos antes del bingo. ${aviso}`;
  return conexion.includes('\n') ? `Anexo enlace para conexión:\n${conexion}\n${aviso}` : `Anexo enlace para conexión: ${conexion}. ${aviso}`;
}

// Devuelve las partes del mensaje; cada canal las arma a su manera (texto de WhatsApp, texto y HTML de correo).
function partesDelMensaje({ nombre, seriales = [], enlace, codigo, fechaSorteo, enlaceConexion, ahora } = {}) {
  const fecha = fechaLarga(fechaSorteo);
  const cantidad = seriales.length;
  const conexion = limpiarConexion(enlaceConexion);
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
      conexionDe(conexion),
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
    + `<ul>${p.puntos.map(x => `<li>${conEnlaces(x).replace(/\n/g, '<br>')}</li>`).join('')}</ul>`
    + [p.anexo, p.descarga, p.codigo].filter(Boolean).map(x => `<p>${conEnlaces(x)}</p>`).join('')
    + `<p>${esc(p.cierre)}</p>`;
  return { asunto: p.asunto, texto, html };
}

module.exports = { fechaLarga, saludoDe, primerNombre, lista, partesDelMensaje, textoWhatsApp, mensajeCorreo, compactarInvitacion, limpiarConexion, ASUNTO };
