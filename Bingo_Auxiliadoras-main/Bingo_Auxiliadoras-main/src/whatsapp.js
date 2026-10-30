// Envío de tablas por WhatsApp Cloud API (Meta).
// Sin credenciales configuradas, devuelve un enlace wa.me para enviar a mano.
const { textoWhatsApp } = require('./mensajes');

function crearWhatsApp({ token, phoneId, plantilla, idioma = 'es', codigoPais = '58', fetchFn = fetch } = {}) {
  const configurado = Boolean(token && phoneId);

  // Número que escribe el comprador -> número internacional solo con dígitos (indicativo + número).
  //  · "+34 612 345 678" o "0034…": ya trae indicativo, se respeta tal cual.
  //  · Si no, se le antepone el indicativo del país elegido (pais) o, sin elegir, el del evento (codigoPais).
  //    Un cero inicial (0412…) es prefijo nacional y se quita; si ya escribió el indicativo, no se duplica.
  function normalizarTelefono(texto, pais) {
    const crudo = String(texto || '').trim();
    let d = crudo.replace(/\D/g, '');
    const indicativo = /^\d{1,3}$/.test(String(pais ?? '')) ? String(pais) : codigoPais;
    let numero;
    if (crudo.startsWith('+') || d.startsWith('00')) {
      numero = d.replace(/^00/, '');
    } else {
      d = d.replace(/^0+/, '');
      numero = d.startsWith(indicativo) && d.length >= indicativo.length + 9 ? d : indicativo + d;
    }
    if (numero.length < 8 || numero.length > 15) throw new Error('El número de WhatsApp no es válido.');
    return numero;
  }

  // Los números ya guardados son internacionales: solo se limpian, nunca se les vuelve a agregar indicativo.
  function numeroGuardado(telefono) {
    const numero = String(telefono || '').replace(/\D/g, '');
    if (numero.length < 8 || numero.length > 15) throw new Error('El número de WhatsApp no es válido.');
    return numero;
  }

  // extra: { fechaSorteo, enlaceConexion, ahora } (datos del Bingo que completan el mensaje).
  function mensajeTablas(nombre, seriales, enlace, codigo, extra = {}) {
    return textoWhatsApp({ nombre, seriales, enlace, codigo, ...extra });
  }

  function enlaceManual(telefono, nombre, seriales, enlace, codigo, extra = {}) {
    const numero = numeroGuardado(telefono);
    return `https://wa.me/${numero}?text=${encodeURIComponent(mensajeTablas(nombre, seriales, enlace, codigo, extra))}`;
  }

  // Devuelve { estado: 'enviado' | 'manual', enlace? } o lanza error si la API rechaza el envío.
  async function enviarTablas({ telefono, nombre, seriales, enlace, codigo, extra }) {
    if (!configurado) return { estado: 'manual', enlace: enlaceManual(telefono, nombre, seriales, enlace, codigo, extra) };

    const to = numeroGuardado(telefono);
    // Las plantillas de Meta no admiten saltos de línea en los parámetros: el enlace va en la misma línea.
    const texto = seriales.join(', ') + (enlace ? ` · ${enlace}` : '') + (codigo ? ` · Código ${codigo}` : '');
    const cuerpo = plantilla
      ? {
          type: 'template',
          template: {
            name: plantilla,
            language: { code: idioma },
            components: [{ type: 'body', parameters: [{ type: 'text', text: nombre }, { type: 'text', text: texto }] }],
          },
        }
      : { type: 'text', text: { body: mensajeTablas(nombre, seriales, enlace, codigo, extra) } };

    const res = await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...cuerpo }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      throw new Error(`WhatsApp respondió ${res.status}: ${detalle.slice(0, 300)}`);
    }
    return { estado: 'enviado' };
  }

  return { configurado, enviarTablas, enlaceManual, mensajeTablas, normalizarTelefono };
}

module.exports = { crearWhatsApp };
