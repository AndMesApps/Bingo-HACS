// Ayuda del Bingo: botón flotante (burbuja con tres puntitos) con un buscador. La persona escribe lo que quiere hacer
// ("cómo cambio el enlace de la reunión") y se le muestran los temas del manual que lo explican.
//  · En el formulario, la página de tablas y el panel: el botón abre una ventanita con el buscador.
//  · En el manual (data-modo="manual"): solo activa el buscador de la parte de arriba.
//  · En el panel, la pestaña Manual usa window.ayudaMontarBuscador.
// Etiqueta: <script src="ayuda.js" data-destino="manual.html#parte-a" data-sugeridos="a1,a2,a3"></script>
(function (global) {
  'use strict';

  // ---------- Búsqueda (sin DOM, se puede probar sola) ----------
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const PARADAS = new Set(('de la el los las un una unos unas que como hago hacer para por donde puedo quiero quisiera necesito saber en con y o a al del ' +
    'mi me se es lo le les su sus esto eso esta este ahora ahorita si no hay algo quien cual cuando tengo debo les llega').split(' '));

  // Palabras de uso común que se dicen distinto a como está escrito el manual.
  const SINONIMOS = {
    link: 'enlace', url: 'enlace', vinculo: 'enlace', direccion: 'enlace',
    wasap: 'whatsapp', whats: 'whatsapp', guasap: 'whatsapp', plata: 'dinero', mail: 'correo', email: 'correo', gmail: 'correo',
    clave: 'contrasena', password: 'contrasena', zoom: 'conexion', meet: 'conexion', reunion: 'conexion', videollamada: 'conexion',
    cartones: 'tablas', carton: 'tablas', cartilla: 'tablas', cartillas: 'tablas', premio: 'premios', ganar: 'ganador', gano: 'ganador',
    balota: 'balotas', bolita: 'balotas', bolitas: 'balotas', cuenta: 'banco', transferir: 'transferencia', pagar: 'pago', cobrar: 'pago',
  };

  // Recorta el final de la palabra para que "cambiar" encuentre "cambio", "cambia", "cambiarlo".
  const raiz = t => (t.length > 6 ? t.slice(0, -3) : t.length > 4 ? t.slice(0, -2) : t);

  function palabrasDe(consulta) {
    const crudas = norm(consulta).split(/[^a-z0-9ñ]+/).filter(t => t.length > 1 && !PARADAS.has(t));
    const todas = [];
    for (const t of crudas) {
      todas.push(t);
      if (SINONIMOS[t]) todas.push(SINONIMOS[t]);
    }
    return [...new Set(todas)];
  }

  // secciones: [{ id, titulo, claves, texto, parte }]. Devuelve las mejores, ordenadas.
  function buscar(secciones, consulta, maximo) {
    const tokens = palabrasDe(consulta);
    if (!tokens.length) return [];
    const resultados = [];
    for (const sec of secciones) {
      const titulo = norm(sec.titulo);
      const claves = norm(sec.claves);
      const texto = sec._texto || (sec._texto = norm(sec.texto));
      let puntaje = 0;
      let aciertos = 0;
      let primera = -1;
      for (const t of tokens) {
        const r = raiz(t);
        let hay = false;
        if (titulo.includes(r)) { puntaje += 6; hay = true; }
        if (claves.includes(r)) { puntaje += 4; hay = true; }
        const pos = texto.indexOf(r);
        if (pos >= 0) {
          puntaje += Math.min(texto.split(r).length - 1, 5);
          if (primera < 0 || pos < primera) primera = pos;
          hay = true;
        }
        if (hay) aciertos += 1;
      }
      // Pide que coincida al menos la mitad de lo que se escribió; así una frase larga no trae temas sueltos.
      if (aciertos < Math.max(1, Math.ceil(tokens.length / 2))) continue;
      if (aciertos === tokens.length) puntaje += 5;
      resultados.push({ id: sec.id, titulo: sec.titulo, parte: sec.parte, puntaje, resumen: recorte(sec.texto, primera) });
    }
    resultados.sort((a, b) => b.puntaje - a.puntaje);
    return resultados.slice(0, maximo || 6);
  }

  function recorte(texto, pos) {
    const t = String(texto).replace(/\s+/g, ' ').trim();
    if (pos < 0 || pos > t.length) return t.slice(0, 140) + (t.length > 140 ? '…' : '');
    const ini = Math.max(0, pos - 60);
    const fin = Math.min(t.length, pos + 100);
    return (ini > 0 ? '…' : '') + t.slice(ini, fin).trim() + (fin < t.length ? '…' : '');
  }

  // ---------- Lectura del manual ----------
  function parteDe(id) {
    return /^a\d/.test(id) ? 'Para el benefactor' : /^b\d/.test(id) ? 'Para la administración' : 'Glosario';
  }

  // Un tema = cada título h2 con su id y todo lo que sigue hasta el siguiente título.
  function extraerSecciones(doc) {
    const secciones = [];
    doc.querySelectorAll('h2[id]').forEach(h => {
      if (h.closest('.parte') || h.closest('.indice')) return;
      let texto = '';
      let n = h.nextElementSibling;
      while (n && n.tagName !== 'H2' && !n.classList.contains('parte')) {
        if (!n.classList.contains('volver')) texto += ' ' + n.textContent;
        n = n.nextElementSibling;
      }
      secciones.push({
        id: h.id,
        titulo: h.textContent.replace(/^\s*\d+\.\s*/, '').trim(),
        claves: h.getAttribute('data-claves') || '',
        texto: texto.replace(/\s+/g, ' ').trim(),
        parte: parteDe(h.id),
      });
    });
    return secciones;
  }

  // ---------- Pantalla del buscador ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function estilos() {
    if (typeof document === 'undefined' || document.getElementById('ayuda-estilos')) return;
    const css = document.createElement('style');
    css.id = 'ayuda-estilos';
    css.textContent =
      '.ay-form{display:flex;gap:8px;flex-wrap:wrap;margin:0}' +
      '.ay-form input{flex:1 1 200px;min-width:0;font:inherit;font-size:1.05rem;padding:12px 14px;border:2px solid #106080;border-radius:12px;background:#fff;color:#1d2a33}' +
      '.ay-form button{font:inherit;font-weight:700;background:#106080;color:#fff;border:0;border-radius:12px;padding:12px 18px;cursor:pointer}' +
      '.ay-sugerencia{font-size:.9rem;margin:6px 0 0;color:#5a6b75}' +
      '.ay-lista{list-style:none;margin:10px 0 0;padding:0}' +
      '.ay-lista li{margin:0 0 8px}' +
      '.ay-res{display:block;text-decoration:none;color:#1d2a33;background:#fff;border:1px solid #cfd8dc;border-left:5px solid #C9A24B;border-radius:10px;padding:10px 12px}' +
      '.ay-res:hover,.ay-res:focus-visible{border-color:#106080;outline:2px solid #106080}' +
      '.ay-res strong{display:block;color:#0F3448;font-size:1rem;line-height:1.3}' +
      '.ay-res small{display:block;color:#5a6b75;margin-top:2px;line-height:1.35}' +
      '.ay-res .ay-parte{display:inline-block;font-size:.72rem;font-weight:700;color:#106080;text-transform:uppercase;letter-spacing:.03em}' +
      '.ay-vacio{margin:10px 0 0;color:#5a6b75}' +
      '.ayuda-flotante{position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;gap:8px;cursor:pointer;' +
      'background:#106080;color:#fff;border:3px solid #C9A24B;border-radius:999px;padding:8px 18px 8px 10px;' +
      'font:700 18px/1 "Segoe UI",Roboto,Arial,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
      '.ayuda-flotante:hover,.ayuda-flotante:focus-visible{background:#0F3448;outline:3px solid #C9A24B;outline-offset:2px}' +
      '.ayuda-flotante svg{width:38px;height:38px;flex:none}' +
      '#ayuda-panel{position:fixed;right:16px;bottom:84px;z-index:51;width:min(94vw,430px);max-height:min(76vh,640px);overflow:auto;' +
      'background:#F6F4EE;color:#1d2a33;border:3px solid #106080;border-radius:16px;padding:14px 14px 12px;box-shadow:0 8px 28px rgba(0,0,0,.4);' +
      'font:16px/1.45 "Segoe UI",Roboto,Arial,sans-serif}' +
      '#ayuda-panel[hidden]{display:none}' +
      '#ayuda-panel h2{margin:0 28px 8px 0;font-size:1.15rem;color:#0F3448}' +
      '#ayuda-panel .ay-cerrar{position:absolute;right:8px;top:6px;background:transparent;color:#0F3448;border:0;font-size:1.6rem;line-height:1;cursor:pointer;padding:4px 8px}' +
      '#ayuda-panel .ay-pie{margin:12px 0 0;text-align:center}' +
      '#ayuda-panel .ay-pie a{font-weight:700;color:#106080}' +
      'h2:target{background:#FFF4D6;border-radius:8px}' +
      '@media print{.ayuda-flotante,#ayuda-panel{display:none!important}}' +
      '@media (max-width:420px){.ayuda-flotante{padding:6px 14px 6px 8px;font-size:16px}.ayuda-flotante svg{width:34px;height:34px}}';
    document.head.appendChild(css);
  }

  // Dibuja el buscador dentro de `contenedor`.
  //  opciones.cargar() -> Promise de las secciones; opciones.enlace(id) -> dirección del tema;
  //  opciones.nueva -> abrir en pestaña nueva; opciones.sugeridos -> ids que se muestran antes de escribir.
  function montarBuscador(contenedor, opciones) {
    estilos();
    const op = opciones || {};
    contenedor.innerHTML =
      '<form class="ay-form" role="search" autocomplete="off">' +
      '<input type="search" placeholder="Escribe lo que quieres hacer o saber" aria-label="Escribe lo que quieres hacer o saber" enterkeyhint="search">' +
      '<button type="submit">Buscar</button></form>' +
      '<p class="ay-sugerencia">Por ejemplo: «cómo cambio el enlace de la reunión» o «cómo envío las tablas».</p>' +
      '<ul class="ay-lista" aria-live="polite"></ul>';
    const form = contenedor.querySelector('form');
    const campo = contenedor.querySelector('input');
    const lista = contenedor.querySelector('ul');
    let secciones = null;
    let cargando = null;

    const asegurar = () => {
      if (secciones) return Promise.resolve(secciones);
      if (!cargando) {
        cargando = Promise.resolve(op.cargar()).then(s => { secciones = s; return s; }).catch(() => { cargando = null; return null; });
      }
      return cargando;
    };

    const pintar = (items, vacio) => {
      if (!items.length) { lista.innerHTML = `<li class="ay-vacio">${esc(vacio)}</li>`; return; }
      lista.innerHTML = items.map(r =>
        `<li><a class="ay-res" href="${esc(op.enlace(r.id))}"${op.nueva ? ' target="_blank" rel="noopener"' : ''}>` +
        `<span class="ay-parte">${esc(r.parte)}</span><strong>${esc(r.titulo)}</strong><small>${esc(r.resumen || '')}</small></a></li>`).join('');
    };

    const mostrarSugeridos = () => asegurar().then(s => {
      if (!s || !op.sugeridos || !op.sugeridos.length || campo.value.trim()) return;
      const items = op.sugeridos.map(id => s.find(x => x.id === id)).filter(Boolean).map(x => ({ id: x.id, titulo: x.titulo, parte: x.parte, resumen: '' }));
      if (items.length) {
        pintar(items, '');
        lista.insertAdjacentHTML('afterbegin', '<li class="ay-sugerencia">Temas que más se consultan:</li>');
      }
    });

    const consultar = () => {
      const q = campo.value.trim();
      if (!q) { lista.innerHTML = ''; return mostrarSugeridos(); }
      lista.innerHTML = '<li class="ay-vacio">Buscando…</li>';
      return asegurar().then(s => {
        if (!s) { lista.innerHTML = '<li class="ay-vacio">No pude cargar el manual. Revisa tu internet e intenta de nuevo.</li>'; return; }
        pintar(buscar(s, q, 6), 'No encontré eso. Prueba con otras palabras (por ejemplo «enviar», «pago», «premio») o mira el índice del manual.');
      });
    };

    form.addEventListener('submit', e => { e.preventDefault(); consultar(); });
    campo.addEventListener('input', () => { if (campo.value.trim().length >= 3) consultar(); else if (!campo.value.trim()) { lista.innerHTML = ''; mostrarSugeridos(); } });
    mostrarSugeridos();
    return { enfocar: () => campo.focus(), consultar };
  }

  // ---------- Montaje en cada página ----------
  let cacheManual = null;
  function cargarManualRemoto(url) {
    if (!cacheManual) {
      cacheManual = fetch(url).then(r => { if (!r.ok) throw new Error('manual'); return r.text(); })
        .then(html => extraerSecciones(new DOMParser().parseFromString(html, 'text/html')))
        .catch(e => { cacheManual = null; throw e; });
    }
    return cacheManual;
  }

  function iniciar() {
    const script = document.currentScript;
    const modo = script && script.getAttribute('data-modo');
    const sugeridos = ((script && script.getAttribute('data-sugeridos')) || '').split(',').map(s => s.trim()).filter(Boolean);

    // En el propio manual: el buscador de arriba.
    if (modo === 'manual') {
      const caja = document.getElementById('buscador-manual');
      if (caja) montarBuscador(caja, { cargar: () => extraerSecciones(document), enlace: id => '#' + id, sugeridos: ['a1', 'a2', 'b5', 'b6', 'b3'] });
      return;
    }

    const destino = (script && script.getAttribute('data-destino')) || 'manual.html';
    const urlManual = new URL('manual.html', document.baseURI).href;

    estilos();
    const panel = document.createElement('div');
    panel.id = 'ayuda-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ayuda');
    panel.innerHTML = '<button type="button" class="ay-cerrar" aria-label="Cerrar la ayuda">×</button><h2>¿Qué necesitas saber?</h2><div id="ayuda-buscador"></div>' +
      `<p class="ay-pie"><a href="${esc(destino)}" target="_blank" rel="noopener">Abrir el manual completo</a></p>`;
    document.body.appendChild(panel);

    const buscador = montarBuscador(panel.querySelector('#ayuda-buscador'), {
      cargar: () => cargarManualRemoto(urlManual), enlace: id => new URL('manual.html#' + id, document.baseURI).href, nueva: true, sugeridos,
    });

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'ayuda-flotante';
    boton.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-label', 'Ayuda: buscar en el manual «Cómo hago…»');
    boton.title = 'Ayuda: busca lo que necesitas';
    boton.innerHTML =
      '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M8 8h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H22l-9 8v-8H8a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fff"/>' +
      '<circle cx="14" cy="21" r="3.2" fill="#106080"/><circle cx="24" cy="21" r="3.2" fill="#106080"/><circle cx="34" cy="21" r="3.2" fill="#106080"/>' +
      '</svg><span>Ayuda</span>';
    document.body.appendChild(boton);

    const abrir = abierto => {
      panel.hidden = !abierto;
      boton.setAttribute('aria-expanded', String(abierto));
      if (abierto) buscador.enfocar();
    };
    boton.addEventListener('click', () => abrir(panel.hidden));
    panel.querySelector('.ay-cerrar').addEventListener('click', () => { abrir(false); boton.focus(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { abrir(false); boton.focus(); } });
    document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && !boton.contains(e.target)) abrir(false); });
  }

  // Para la pestaña Manual del panel.
  global.ayudaMontarBuscador = function (contenedor, urlManual) {
    const url = new URL(urlManual || 'manual.html', document.baseURI).href;
    return montarBuscador(contenedor, { cargar: () => cargarManualRemoto(url), enlace: id => new URL(url).origin + new URL(url).pathname + '#' + id, nueva: true,
      sugeridos: ['b5', 'b6', 'b7', 'b3', 'b15'] });
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buscar, palabrasDe, norm, raiz, extraerSecciones, recorte };
  } else if (typeof document !== 'undefined') {
    iniciar();
  }
})(typeof window !== 'undefined' ? window : globalThis);
