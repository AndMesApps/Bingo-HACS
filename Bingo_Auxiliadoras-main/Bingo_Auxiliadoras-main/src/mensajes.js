// Mensaje que recibe cada benefactor con sus tablas (WhatsApp manual y correo). Un solo texto para los dos canales.
// El texto es una plantilla editable desde Configuración: lo que va entre llaves, como {nombre} o {fecha}, se reemplaza
// por los datos de cada compra. Si no se ha cambiado, se usa PLANTILLA_ORIGINAL.

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

const capitalizar = p => (p ? p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : '');

// 'TERESITA PÉREZ' -> 'Teresita'
function primerNombre(nombre) {
  return capitalizar(String(nombre ?? '').trim().split(/\s+/)[0] || '');
}

// 'TERESITA PÉREZ' -> 'Teresita Pérez'
function nombreCompleto(nombre) {
  return String(nombre ?? '').trim().split(/\s+/).filter(Boolean).map(capitalizar).join(' ');
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

// ---------- Plantilla editable ----------
// Etiquetas que se pueden usar en el texto, con lo que significan (para mostrarlas en Configuración).
const ETIQUETAS = [
  { nombre: 'saludo', descripcion: 'Buenos días, Buenas tardes o Buenas noches, según la hora' },
  { nombre: 'nombre', descripcion: 'El primer nombre del benefactor (Teresita)' },
  { nombre: 'nombre_completo', descripcion: 'El nombre completo del benefactor (Teresita Pérez)' },
  { nombre: 'fecha_frase', descripcion: 'La frase «, a realizarse el domingo 22 de noviembre del 2026» (no sale si no hay fecha)' },
  { nombre: 'fecha', descripcion: 'La fecha del bingo (domingo 22 de noviembre del 2026)' },
  { nombre: 'cantidad', descripcion: 'Cuántas tablas son (2 tablas)' },
  { nombre: 'numeros', descripcion: 'Los números de sus tablas (12 y 87)' },
  { nombre: 'enlace', descripcion: 'El enlace privado para descargar sus tablas' },
  { nombre: 'codigo', descripcion: 'El código de la compra (BNG-AB12CD)' },
  { nombre: 'conexion_bloque', descripcion: 'Los datos de la reunión (enlace, ID y hora), o un aviso si todavía no están' },
];
const NOMBRES_ETIQUETAS = new Set(ETIQUETAS.map(e => e.nombre));
// Etiquetas que pueden quedar vacías sin que se borre la línea donde están.
const ETIQUETAS_OPCIONALES = new Set(['fecha_frase']);

const PLANTILLA_ORIGINAL = `{saludo} {nombre}, esperando estén super bien.

*¡Tus tablas de bingo!*

Agradecemos su participación en el Bingo de las Hermanas Auxiliadoras de Cristo Sacerdote{fecha_frase}.

A continuación le anexamos información que le puede servir para tener un buen juego:
• Las tablas están enumeradas en la parte superior, en el óvalo dorado que dice «TABLA N° …», debajo del logo. Por fa tenga el número ubicado porque es importante en el juego.
• Cada tabla va marcada con su nombre: en la franja azul de abajo, donde dice «Válida únicamente para …», y como marca de agua en toda la tabla. Es solo para usted y no se puede transferir.
• Le recomendamos tener sus tablas impresas o hacerlas a mano antes del bingo para que sea fácil jugar tapando con papelitos que previamente se tengan preparados.
• {conexion_bloque}
No es requerido que tenga cámara abierta; es importante que tenga facilidad para escribir por el chat de la reunión, para cantar bingo, si corresponde.

Anexo: {cantidad} (N° {numeros}).
Descárguelas aquí: {enlace}
Código de su compra: {codigo} (guárdelo para consultar el estado).

Gracias, feliz día.`;

// Devuelve '' si la plantilla sirve, o el motivo por el que no. Se valida al guardar para que un error de tipeo
// (por ejemplo {nombr}) no llegue a los benefactores.
function validarPlantilla(texto) {
  const t = String(texto ?? '');
  if (t.length > 4000) return 'El texto del mensaje es demasiado largo (máximo 4000 caracteres).';
  const desconocidas = [...new Set((t.match(/\{[^{}\n]*\}/g) || []).map(x => x.slice(1, -1)).filter(x => !NOMBRES_ETIQUETAS.has(x)))];
  if (desconocidas.length) {
    return `Hay etiquetas que no existen: ${desconocidas.map(x => `{${x}}`).join(', ')}. Las permitidas son: ${ETIQUETAS.map(e => `{${e.nombre}}`).join(', ')}.`;
  }
  if (!t.includes('{enlace}')) return 'El mensaje debe incluir la etiqueta {enlace}: es por donde cada benefactor descarga sus tablas.';
  return '';
}

// Valores con los que se reemplaza cada etiqueta.
function valoresDelMensaje({ nombre, seriales = [], enlace, codigo, fechaSorteo, enlaceConexion, ahora } = {}) {
  const fecha = fechaLarga(fechaSorteo);
  const cantidad = seriales.length;
  const conexion = limpiarConexion(enlaceConexion);
  return {
    saludo: saludoDe(ahora),
    nombre: primerNombre(nombre),
    nombre_completo: nombreCompleto(nombre),
    fecha,
    fecha_frase: fecha ? `, a realizarse el ${fecha}` : '',
    cantidad: cantidad ? `${cantidad} ${cantidad === 1 ? 'tabla' : 'tablas'}` : '',
    numeros: lista(seriales),
    enlace: enlace || '',
    codigo: codigo || '',
    conexion_bloque: !conexion ? 'El enlace para conexión se lo enviaremos antes del bingo.'
      : conexion.includes('\n') ? `Anexo enlace para conexión:\n${conexion}` : `Anexo enlace para conexión: ${conexion}`,
  };
}

// Reemplaza las etiquetas. Una línea que tenga alguna etiqueta sin datos (por ejemplo {codigo} vacío) se quita entera.
function renderizar(plantilla, valores) {
  const lineas = [];
  for (const linea of String(plantilla).split(/\r?\n/)) {
    const etiquetas = linea.match(/\{[a-z_]+\}/g) || [];
    const vacia = etiquetas.some(e => {
      const nombre = e.slice(1, -1);
      return NOMBRES_ETIQUETAS.has(nombre) && !ETIQUETAS_OPCIONALES.has(nombre) && !valores[nombre];
    });
    if (vacia) continue;
    lineas.push(linea.replace(/\{([a-z_]+)\}/g, (todo, nombre) => (NOMBRES_ETIQUETAS.has(nombre) ? valores[nombre] : todo)));
  }
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const textoDeMensaje = datos => renderizar((datos && datos.plantilla) || PLANTILLA_ORIGINAL, valoresDelMensaje(datos));

// Texto para WhatsApp (el *texto* entre asteriscos sale en negrita).
const textoWhatsApp = datos => textoDeMensaje(datos);

// ---------- Correo ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Convierte las direcciones web del texto en enlaces.
const conEnlaces = s => esc(s).replace(/(https?:\/\/[^\s<]+?)(?=[.,;]?(?:\s|$))/g, '<a href="$1">$1</a>');
const formato = s => conEnlaces(s).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

// Párrafos separados por línea en blanco; las líneas con «• » forman una lista (las líneas siguientes sin viñeta
// continúan la viñeta anterior).
function textoAHtml(texto) {
  return texto.split(/\n{2,}/).map(bloque => {
    const lineas = bloque.split('\n');
    if (!lineas.some(l => l.startsWith('• '))) return `<p>${formato(bloque)}</p>`;
    const previas = [];
    const items = [];
    for (const l of lineas) {
      if (l.startsWith('• ')) items.push([l.slice(2)]);
      else if (items.length) items[items.length - 1].push(l);
      else previas.push(l);
    }
    return (previas.length ? `<p>${formato(previas.join('\n'))}</p>` : '') + `<ul>${items.map(i => `<li>${formato(i.join('\n'))}</li>`).join('')}</ul>`;
  }).join('');
}

function mensajeCorreo(datos) {
  const texto = textoDeMensaje(datos);
  return { asunto: ASUNTO, texto: texto.replace(/\*([^*\n]+)\*/g, '$1'), html: textoAHtml(texto) };
}

module.exports = {
  fechaLarga, saludoDe, primerNombre, nombreCompleto, lista, textoWhatsApp, mensajeCorreo, textoAHtml,
  compactarInvitacion, limpiarConexion, validarPlantilla, valoresDelMensaje, renderizar,
  PLANTILLA_ORIGINAL, ETIQUETAS, ASUNTO,
};
