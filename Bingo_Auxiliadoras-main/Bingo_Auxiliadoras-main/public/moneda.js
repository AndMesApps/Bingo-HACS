// Campos de dinero con separador de miles (.) mientras se escribe y sin decimales.
// Los campos marcados con class="moneda" muestran "20.000", pero su .value sigue devolviendo "20000"
// (y al asignar .value acepta un número simple), así el resto del código no cambia.
(() => {
  const nativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const miles = d => d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const digitos = s => String(s ?? '').replace(/\D/g, '');
  const deNumero = v => {
    const t = String(v ?? '').trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? String(Math.max(0, Math.round(n))) : '';
  };

  function iniciar(el) {
    if (el.__moneda) return;
    el.__moneda = true;
    el.type = 'text';
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('autocomplete', 'off');
    const poner = d => nativo.set.call(el, miles(d));
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return digitos(nativo.get.call(el)); },
      set(v) { poner(deNumero(v)); },
    });
    poner(deNumero(nativo.get.call(el)));
    el.addEventListener('input', () => {
      const texto = nativo.get.call(el);
      const pos = el.selectionStart ?? texto.length;
      const antes = digitos(texto.slice(0, pos)).length;
      poner(digitos(texto));
      const nuevo = nativo.get.call(el);
      let n = 0, i = 0;
      while (i < nuevo.length && n < antes) { if (/\d/.test(nuevo[i])) n++; i++; }
      try { el.setSelectionRange(i, i); } catch { /* sin cursor */ }
    });
  }

  const barrer = raiz => {
    if (raiz.nodeType !== 1) return;
    if (raiz.matches?.('input.moneda')) iniciar(raiz);
    raiz.querySelectorAll?.('input.moneda').forEach(iniciar);
  };
  barrer(document.documentElement);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(barrer))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => barrer(document.documentElement));
})();
