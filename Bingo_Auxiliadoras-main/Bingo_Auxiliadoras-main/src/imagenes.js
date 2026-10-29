// Imágenes de las tablas (N.jpg) en un bucket privado de Supabase Storage.
// La clave de servicio solo vive en el servidor: el comprador ve la imagen a través de /api/publico/entrega.

const SERIAL_VALIDO = /^[A-Za-z0-9._-]{1,40}$/;

function crearImagenes({ url, clave, bucket = 'tablas', fetchFn = fetch } = {}) {
  const configurado = Boolean(url && clave);

  // Devuelve { buffer, tipo } o null si no hay imagen para ese serial.
  async function leer(serial) {
    if (!configurado || !SERIAL_VALIDO.test(String(serial))) return null;
    const headers = { apikey: clave };
    if (clave.startsWith('eyJ')) headers.Authorization = `Bearer ${clave}`; // claves JWT antiguas
    const res = await fetchFn(`${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeURIComponent(serial)}.jpg`, { headers });
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), tipo: res.headers.get('content-type') || 'image/jpeg' };
  }

  return { configurado, leer };
}

module.exports = { crearImagenes };
