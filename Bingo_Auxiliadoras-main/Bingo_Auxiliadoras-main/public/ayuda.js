// Botón flotante de ayuda: una burbuja con tres puntitos abajo a la derecha que lleva al manual «Cómo hago…».
// Cada página dice a qué parte del manual lleva con data-destino en la etiqueta <script>.
(function () {
  var script = document.currentScript;
  var destino = (script && script.getAttribute('data-destino')) || 'manual.html';

  var css = document.createElement('style');
  css.textContent =
    '.ayuda-flotante{position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;gap:8px;' +
    'background:#106080;color:#fff;border:3px solid #C9A24B;border-radius:999px;padding:8px 18px 8px 10px;' +
    'font:700 18px/1 "Segoe UI",Roboto,Arial,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
    '.ayuda-flotante:hover,.ayuda-flotante:focus-visible{background:#0F3448;outline:3px solid #C9A24B;outline-offset:2px}' +
    '.ayuda-flotante svg{width:38px;height:38px;flex:none}' +
    '@media print{.ayuda-flotante{display:none!important}}' +
    '@media (max-width:420px){.ayuda-flotante{padding:6px 14px 6px 8px;font-size:16px}.ayuda-flotante svg{width:34px;height:34px}}';
  document.head.appendChild(css);

  var a = document.createElement('a');
  a.className = 'ayuda-flotante';
  a.href = destino;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Ayuda: abrir el manual «Cómo hago…»');
  a.title = 'Ayuda: manual «Cómo hago…»';
  a.innerHTML =
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
    '<path d="M8 8h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H22l-9 8v-8H8a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fff"/>' +
    '<circle cx="14" cy="21" r="3.2" fill="#106080"/><circle cx="24" cy="21" r="3.2" fill="#106080"/><circle cx="34" cy="21" r="3.2" fill="#106080"/>' +
    '</svg><span>Ayuda</span>';
  document.body.appendChild(a);
})();
