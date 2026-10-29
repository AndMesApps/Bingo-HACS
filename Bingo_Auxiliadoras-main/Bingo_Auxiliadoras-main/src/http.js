const { ErrorApp } = require('./servicios');

// La ruta se toma de la URL real (/api/publico/compras/BNG-1 -> /compras/BNG-1). Es lo más fiable: según el
// entorno, el parámetro catch-all [...ruta] llega como lista, como texto con barras o no llega.
function rutaDe(req) {
  if (req.url) {
    const camino = String(req.url).split('?')[0].replace(/^\/api\/(publico|admin)(?=\/|$)/, '');
    return '/' + camino.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  }
  const partes = req.query?.ruta ?? [];
  const lista = Array.isArray(partes) ? partes : String(partes).split('/');
  return '/' + lista.filter(Boolean).join('/');
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
