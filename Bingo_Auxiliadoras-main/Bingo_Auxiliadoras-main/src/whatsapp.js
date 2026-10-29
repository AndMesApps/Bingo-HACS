// Envío de tablas por WhatsApp Cloud API (Meta).
// Sin credenciales configuradas, devuelve un enlace wa.me para enviar a mano.

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

  function mensajeTablas(nombre, seriales, enlace) {
    const lista = seriales.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const descarga = enlace ? `\nDescárgalas aquí: ${enlace}` : '';
    return `Hola ${nombre}, tu pago fue verificado. Estas son tus tablas de bingo:\n${lista}${descarga}\n¡Gracias por tu compra!`;
  }

  function enlaceManual(telefono, nombre, seriales, enlace) {
    const numero = numeroGuardado(telefono);
    return `https://wa.me/${numero}?text=${encodeURIComponent(mensajeTablas(nombre, seriales, enlace))}`;
  }

  // Devuelve { estado: 'enviado' | 'manual', enlace? } o lanza error si la API rechaza el envío.
  async function enviarTablas({ telefono, nombre, seriales, enlace }) {
    if (!configurado) return { estado: 'manual', enlace: enlaceManual(telefono, nombre, seriales, enlace) };

    const to = numeroGuardado(telefono);
    // Las plantillas de Meta no admiten saltos de línea en los parámetros: el enlace va en la misma línea.
    const texto = seriales.join(', ') + (enlace ? ` · ${enlace}` : '');
    const cuerpo = plantilla
      ? {
          type: 'template',
          template: {
            name: plantilla,
            language: { code: idioma },
            components: [{ type: 'body', parameters: [{ type: 'text', text: nombre }, { type: 'text', text: texto }] }],
          },
        }
      : { type: 'text', text: { body: mensajeTablas(nombre, seriales, enlace) } };

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
