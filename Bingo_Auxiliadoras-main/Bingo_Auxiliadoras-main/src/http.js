const { ErrorApp } = require('./servicios');

// Cada API es una sola función (api/publico.js, api/admin.js) y vercel.json reescribe
// /api/publico/compras/BNG-1 -> /api/publico?ruta=compras/BNG-1. Aquí se reconstruye la ruta:
// primero el parámetro ?ruta (texto con barras o lista) y, si no llega, la URL real.
function rutaDe(req) {
  const param = req.query?.ruta;
  if (param !== undefined && param !== '') {
    const lista = (Array.isArray(param) ? param : String(param).split('/')).filter(Boolean);
    return '/' + lista.join('/');
  }
  if (req.url) {
    const camino = String(req.url).split('?')[0].replace(/^\/api\/(publico|admin)(?=\/|$)/, '');
    return '/' + camino.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  }
  return '/';
}

async function enrutar(rutas, req, res) {
  const ruta = rutaDe(req);
  for (const r of rutas) {
    if (r.metodo !== req.method) continue;
    const m = ruta.match(r.patron);
    if (m) return r.handler(m.slice(1), req, res);
  }
  res.status(404).json({ error: 'No encontrado.' });
}

function responderError(res, err) {
  if (err instanceof ErrorApp) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error interno. Revisa los logs de Vercel.' });
}

module.exports = { enrutar, responderError, rutaDe };
