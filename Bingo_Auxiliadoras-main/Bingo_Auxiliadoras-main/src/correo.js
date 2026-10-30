// Envío de tablas por correo con Resend (https://resend.com).
// Sin credenciales configuradas, devuelve un enlace mailto: para enviar a mano.
const { mensajeCorreo } = require('./mensajes');

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function crearCorreo({ apiKey, desde, fetchFn = fetch } = {}) {
  const configurado = Boolean(apiKey && desde);

  // extra: { fechaSorteo, enlaceConexion, ahora } (datos del Bingo que completan el mensaje).
  function mensajeTablas(nombre, seriales, enlace, codigo, extra = {}) {
    return mensajeCorreo({ nombre, seriales, enlace, codigo, ...extra });
  }

  function enlaceManual(correo, nombre, seriales, enlace, codigo, extra = {}) {
    const m = mensajeTablas(nombre, seriales, enlace, codigo, extra);
    return `mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(m.asunto)}&body=${encodeURIComponent(m.texto)}`;
  }

  // Devuelve { estado: 'enviado' | 'manual', enlace? } o lanza error si Resend rechaza el envío.
  async function enviarTablas({ correo, nombre, seriales, enlace, codigo, extra }) {
    if (!configurado) return { estado: 'manual', enlace: enlaceManual(correo, nombre, seriales, enlace, codigo, extra) };
    const m = mensajeTablas(nombre, seriales, enlace, codigo, extra);
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
