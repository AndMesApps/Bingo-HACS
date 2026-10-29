// Envío de tablas por correo con Resend (https://resend.com).
// Sin credenciales configuradas, devuelve un enlace mailto: para enviar a mano.

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function crearCorreo({ apiKey, desde, fetchFn = fetch } = {}) {
  const configurado = Boolean(apiKey && desde);

  function mensajeTablas(nombre, seriales, enlace) {
    const lista = seriales.join(', ');
    const texto = `Hola ${nombre},\n\nTu pago fue verificado. Tus tablas de bingo: ${lista}.\n`
      + (enlace ? `\nDescárgalas aquí: ${enlace}\n` : '')
      + '\n¡Gracias por tu compra!';
    const html = `<p>Hola ${escHtml(nombre)},</p><p>Tu pago fue verificado. Tus tablas de bingo: <strong>${escHtml(lista)}</strong>.</p>`
      + (enlace ? `<p><a href="${escHtml(enlace)}">Descargar mis tablas</a></p>` : '')
      + '<p>¡Gracias por tu compra!</p>';
    return { asunto: 'Tus tablas del bingo', texto, html };
  }

  function enlaceManual(correo, nombre, seriales, enlace) {
    const m = mensajeTablas(nombre, seriales, enlace);
    return `mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(m.asunto)}&body=${encodeURIComponent(m.texto)}`;
  }

  // Devuelve { estado: 'enviado' | 'manual', enlace? } o lanza error si Resend rechaza el envío.
  async function enviarTablas({ correo, nombre, seriales, enlace }) {
    if (!configurado) return { estado: 'manual', enlace: enlaceManual(correo, nombre, seriales, enlace) };
    const m = mensajeTablas(nombre, seriales, enlace);
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: desde, to: [correo], subject: m.asunto, text: m.texto, html: m.html }),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { estado: 'enviado' };
  }

  return { configurado, enviarTablas, enlaceManual, mensajeTablas };
}

module.exports = { crearCorreo };
