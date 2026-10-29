const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let moneda = '';
let vistaActual = 'resumen';
let filtroCompras = 'por_verificar';

const dinero = n => `${moneda ? moneda + ' ' : ''}${Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })}`;
const fecha = s => s ? String(s).slice(0, 16).replace('T', ' ') : '';

async function api(metodo, url, cuerpo) {
  const res = await fetch('/api' + url, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // En el login, un 401 es "contraseña incorrecta" (el mensaje viene del servidor); en cualquier otra llamada, sesión vencida.
  if (res.status === 401 && url !== '/admin/login') { mostrarLogin(); throw new Error('Sesión vencida. Vuelve a entrar.'); }
  if (!res.ok) throw new Error(data.error || 'Error inesperado.');
  return data;
}

function msg(texto, malo) {
  $('msg').textContent = texto;
  $('msg').className = 'msg' + (malo ? ' bad' : '');
}

async function accion(fn, ok) {
  try {
    await fn();
    if (ok) msg(ok);
  } catch (err) {
    msg(err.message, true);
  }
}

function mostrarLogin() {
  $('panel').hidden = true;
  $('salir').hidden = true;
  $('login').hidden = false;
}

const VISTAS = {
  resumen: { titulo: 'Resumen', render: renderResumen },
  compras: { titulo: 'Compras', render: renderCompras },
  sobrantes: { titulo: 'Sobrantes', render: renderSobrantes },
  tablas: { titulo: 'Tablas', render: renderTablas },
  premios: { titulo: 'Premios', render: renderPremios },
  gastos: { titulo: 'Gastos', render: renderGastos },
  config: { titulo: 'Configuración', render: renderConfig },
  reportes: { titulo: 'Reportes', render: renderReportes },
  bitacora: { titulo: 'Bitácora', render: renderBitacora },
};

function dibujarTabs() {
  $('tabs').innerHTML = Object.entries(VISTAS).map(([k, v]) =>
    `<button type="button" data-vista="${k}" aria-selected="${k === vistaActual}">${v.titulo}</button>`).join('');
}

async function mostrar(nombre) {
  vistaActual = nombre;
  dibujarTabs();
  try {
    await VISTAS[nombre].render();
  } catch (err) {
    msg(err.message, true);
  }
}

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-vista]');
  if (b) { msg(''); mostrar(b.dataset.vista); }
});

$('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('POST', '/admin/login', { clave: e.target.clave.value });
    e.target.reset();
    $('login-msg').textContent = '';
    await entrar();
  } catch (err) {
    $('login-msg').textContent = err.message;
  }
});

$('salir').addEventListener('click', async () => {
  await api('POST', '/admin/logout').catch(() => {});
  mostrarLogin();
});

async function entrar() {
  const r = await api('GET', '/admin/resumen');
  moneda = r.evento.moneda;
  $('titulo').textContent = r.evento.nombre || 'Bingo';
  $('login').hidden = true;
  $('panel').hidden = false;
  $('salir').hidden = false;
  mostrar(vistaActual);
}

// ---------- Resumen ----------
async function renderResumen() {
  const r = await api('GET', '/admin/resumen');
  const d = r.dinero;
  const t = r.tablas;
  const enlace = location.origin + '/';
  const invitacion = `Te invitamos a ${r.evento.nombre || 'nuestro bingo'} de las Hermanas Auxiliadoras de Cristo Sacerdote. Compra tus tablas aquí: ${enlace}`;
  const pct = t.total ? Math.round((t.vendidas / t.total) * 100) : 0;
  const pendientes = r.compras.porVerificar + r.compras.listasParaEnviar;
  const sobrantesPend = r.dinero.porDevolver > 0;
  $('vista').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Enlace para los benefactores</h2>
      <p class="muted" style="margin-top:-6px">Compártelo por WhatsApp, redes o correo: ahí compran sus tablas y suben el comprobante.</p>
      <div class="row" style="flex-wrap:nowrap;gap:8px">
        <input id="enlace-pub" readonly value="${esc(enlace)}" aria-label="Enlace de compra">
        <button type="button" data-copiar="${esc(enlace)}">Copiar</button>
      </div>
      <div class="actions">
        <a class="btn ghost" href="${esc(enlace)}" target="_blank" rel="noopener">Abrir formulario</a>
        <a class="btn ghost" href="https://wa.me/?text=${encodeURIComponent(invitacion)}" target="_blank" rel="noopener">Compartir por WhatsApp</a>
        <button type="button" class="ghost" data-copiar="${esc(invitacion)}">Copiar invitación</button>
      </div>
    </div>
    ${pendientes ? `<div class="note"><strong>${pendientes}</strong> compra(s) esperan tu atención:
      ${r.compras.porVerificar} por verificar y ${r.compras.listasParaEnviar} lista(s) para enviar.
      <button type="button" class="ghost" data-vista-ir="compras" style="margin-left:8px">Ir a compras</button></div>` : ''}
    ${sobrantesPend ? `<div class="note"><strong>${dinero(r.dinero.porDevolver)}</strong> de sobrantes esperan una decisión o una devolución.
      <button type="button" class="ghost" data-vista-ir="sobrantes" style="margin-left:8px">Ver sobrantes</button></div>` : ''}
    <div class="card">
      <div class="row"><strong>Tablas vendidas</strong><span>${t.vendidas} de ${t.total} (${pct}%)</span></div>
      <div style="height:12px;border-radius:999px;background:var(--azul-claro);overflow:hidden;margin-top:8px" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--azul-medio),var(--azul-oscuro))"></div>
      </div>
    </div>
    <h2>Dinero</h2>
    <div class="stats">
      <div class="card stat"><span class="muted">Cobrado (verificado)</span><strong>${dinero(d.cobrado)}</strong></div>
      <div class="card stat"><span class="muted">Por verificar</span><strong>${dinero(d.porVerificar)}</strong></div>
      <div class="card stat"><span class="muted">Por cobrar (deuda)</span><strong>${dinero(d.porCobrar)}</strong></div>
      <div class="card stat"><span class="muted">Donaciones (sobrantes donados)</span><strong>${dinero(d.donaciones)}</strong></div>
      <div class="card stat"><span class="muted">Por devolver a compradores</span><strong class="${d.porDevolver > 0 ? 'neg' : ''}">${dinero(d.porDevolver)}</strong></div>
      <div class="card stat"><span class="muted">Ya devuelto</span><strong>${dinero(d.devuelto)}</strong></div>
      <div class="card stat"><span class="muted">Premios pagados</span><strong>${dinero(d.premiosPagados)}</strong></div>
      <div class="card stat"><span class="muted">Gastos</span><strong>${dinero(d.gastos)}</strong></div>
      <div class="card stat"><span class="muted">Balance en caja</span><strong class="${d.balance < 0 ? 'neg' : ''}">${dinero(d.balance)}</strong></div>
    </div>
    <p class="muted">Premios programados: ${dinero(d.premiosProgramados)} · Balance si se cobra todo lo pendiente: ${dinero(d.balance + d.porCobrar)}</p>
    <div class="card"><h2>Cobrado por método</h2>
      ${d.porMetodo.map(m => `<div class="kv"><span>${esc(m.metodo)}</span><strong>${dinero(m.monto)}</strong></div>`).join('') || '<p class="muted">Aún no hay pagos verificados.</p>'}
    </div>
    <h2>Tablas</h2>
    <div class="stats">
      <div class="card stat"><span class="muted">Disponibles</span><strong>${t.disponibles}</strong></div>
      <div class="card stat"><span class="muted">Libres para vender</span><strong>${t.libresParaVender}</strong></div>
      <div class="card stat"><span class="muted">Vendidas</span><strong>${t.vendidas}</strong></div>
      <div class="card stat"><span class="muted">Por enviar</span><strong>${t.porEnviar}</strong></div>
      <div class="card stat"><span class="muted">Entregadas</span><strong>${t.entregadas}</strong></div>
    </div>
    <h2>Pendientes</h2>
    <div class="card">
      <div class="kv"><span>Pagos por verificar</span><strong>${r.compras.porVerificar} compra(s)</strong></div>
      <div class="kv"><span>Listas para enviar tablas</span><strong>${r.compras.listasParaEnviar} compra(s)</strong></div>
      <div class="kv"><span>Compras con deuda</span><strong>${r.compras.conDeuda}</strong></div>
    </div>`;
}

// ---------- Compras ----------
const ESTADOS_COMPRA = [['por_verificar', 'Por verificar'], ['verificada', 'Listas para enviar'], ['enviada', 'Enviadas'], ['donacion', 'Donaciones'], ['rechazada', 'Rechazadas'], ['', 'Todas']];

async function renderCompras() {
  const compras = await api('GET', '/admin/compras' + (filtroCompras ? `?estado=${filtroCompras}` : ''));
  $('vista').innerHTML = `
    <div class="tabs">${ESTADOS_COMPRA.map(([k, t]) =>
      `<button type="button" class="${filtroCompras === k ? '' : 'ghost'}" data-filtro="${k}">${t}</button>`).join('')}</div>
    <div id="lista">${compras.map(tarjetaCompra).join('') || '<p class="muted">No hay compras en esta lista.</p>'}</div>`;
  // Los pagos por verificar se abren solos: es lo primero que necesita quien verifica.
  $('vista').querySelectorAll('[data-compra][data-abrir] details').forEach(d => { d.open = true; });
}

function tarjetaCompra(c) {
  const saldo = c.saldo > 0 ? `<span class="neg">Debe ${dinero(c.saldo)}</span>` : '<span>Al día</span>';
  const contacto = [c.codigo, c.telefono, c.correo, c.ciudad, c.cedula ? 'CC ' + c.cedula : ''].filter(Boolean).map(esc).join(' · ');
  const resumenPago = c.cantidad === 0
    ? `Donación (pagó menos que una tabla y decidió donarlo) · Verificado ${dinero(c.pagado)}`
    : c.estado === 'por_verificar'
    ? `Pidió ${c.cantidad} tabla(s) · el pago reportado alcanza para ${c.tablasReportadas}`
    : `Pidió ${c.cantidad} tabla(s)${c.tablasAprobadas ? ` · se enviaron ${c.tablasAprobadas}` : ''} · Total ${dinero(c.total)} · Pagado ${dinero(c.pagado)} · ${saldo}`;
  return `
  <article class="card" data-compra="${c.id}" ${c.estado === 'por_verificar' ? 'data-abrir' : ''}>
    <div class="row">
      <strong>${esc(c.nombre)}</strong>
      <span class="pill ${esc(c.estado)}">${esc(c.estado.replace('_', ' '))}</span>
    </div>
    <p class="muted">${contacto}</p>
    ${c.referidoPor ? `<p class="muted">Se enteró por: ${esc(c.referidoPor)}</p>` : ''}
    <p>${resumenPago}</p>
    ${c.tablas.length ? `<p class="mono">${c.tablas.map(esc).join(', ')}</p>` : ''}
    ${c.estado === 'verificada' ? panelEnvio(c) : ''}
    ${c.estado === 'enviada' ? estadoEntrega(c) : ''}
    <div class="actions" data-acciones>
      ${botonesCompra(c)}
    </div>
    <details style="margin-top:12px"><summary class="muted">Pagos y comprobantes</summary>
      <div data-pagos></div>
    </details>
  </article>`;
}

// Quien verifica define cuántas tablas se entregan y por cuáles canales.
function panelEnvio(c) {
  const sug = c.tablasSugeridas;
  const descuadre = sug !== c.cantidad;
  return `
  <form class="envio" data-enviar="${c.id}" data-nombre="${esc(c.nombre)}">
    <div class="calc ${descuadre ? 'alerta' : ''}">
      <span class="num">${sug}</span>
      <span class="txt">Con ${dinero(c.pagado)} verificados corresponden <strong>${sug}</strong> tabla(s) a ${dinero(c.precioUnitario)}.
        El comprador pidió ${c.cantidad}.${sug < 1 ? ' El pago no alcanza para una tabla.' : ''}</span>
    </div>
    <div class="grid" style="margin-top:12px">
      <label>Tablas a enviar <input name="cantidad" type="number" min="1" value="${sug || ''}" required data-pagado="${c.pagado}" data-precio="${c.precioUnitario}"></label>
    </div>
    <p class="muted" data-sobrante-info data-eleccion="${esc(c.sobranteDestino)}" data-nota="${esc(c.sobranteNota)}" style="margin:8px 0 0"></p>
    <div class="checks">
      <label><input type="checkbox" name="whatsapp" checked> WhatsApp</label>
      <label class="${c.correo ? '' : 'off'}"><input type="checkbox" name="correo" ${c.correo ? 'checked' : 'disabled'}> Correo${c.correo ? '' : ' (sin correo)'}</label>
      <label><input type="checkbox" name="fisica"> Entrega física</label>
    </div>
    <div class="actions"><button type="submit">Asignar y enviar tablas</button></div>
  </form>`;
}

function estadoEntrega(c) {
  const fila = (nombre, estado, error, botones) => `
    <div class="kv" style="align-items:center">
      <span>${nombre}: <span class="pill ${esc(estado)}">${esc(estado.replace('_', ' '))}</span> ${error ? `<span class="neg">${esc(error)}</span>` : ''}</span>
      <span class="actions" style="margin:0">${botones}</span>
    </div>`;
  const b = (act, canal, texto, clase = 'ghost') => `<button type="button" class="${clase}" data-act="${act}" data-canal="${canal}" data-id="${c.id}">${texto}</button>`;
  const wa = fila('WhatsApp', c.whatsappEstado, c.whatsappError,
    b('reenviar', 'whatsapp', 'Reintentar') + b('enlace', 'whatsapp', 'WhatsApp manual')
    + (c.whatsappEstado !== 'enviado' ? b('marcar', 'whatsapp', 'Marcar enviado') : ''));
  const co = c.correo ? fila('Correo', c.correoEstado, c.correoError,
    b('reenviar', 'correo', 'Reintentar') + b('enlace-correo', 'correo', 'Correo manual')
    + (c.correoEstado !== 'enviado' ? b('marcar', 'correo', 'Marcar enviado') : '')) : '';
  const fi = c.fisicaEstado === 'no'
    ? fila('Entrega física', 'no', '', b('fisica-pendiente', '', 'Registrar entrega física'))
    : fila('Entrega física', c.fisicaEstado, c.fisicaNota ? c.fisicaNota : '',
      c.fisicaEstado === 'pendiente' ? b('fisica-entregada', '', 'Marcar entregada', '') : '');
  const enlace = c.tokenEntrega ? `${location.origin}/tablas.html?t=${c.tokenEntrega}` : '';
  const so = c.sobranteMonto > 0 ? filaSobrante(c) : '';
  return `<div class="envio">${wa}${co}${fi}${so}
    ${enlace ? `<div class="actions"><button type="button" class="ghost" data-copiar="${esc(enlace)}">Copiar enlace privado de sus tablas</button></div>` : ''}</div>`;
}

// ---------- Sobrantes: lo pagado por encima de las tablas entregadas ----------
const ESTADO_SOBRANTE = { por_definir: 'por definir', donado: 'donado', por_devolver: 'por devolver', devuelto: 'devuelto', ninguno: 'ninguno' };
const ELECCION = { donacion: 'quiso donarlo', devolucion: 'pidió que se lo devuelvan', '': 'no eligió' };

function filaSobrante(c) {
  const b = (act, texto, clase = 'ghost') => `<button type="button" class="${clase}" data-act="${act}" data-id="${c.id}">${texto}</button>`;
  const botones = c.sobranteEstado === 'por_definir'
    ? b('sobrante-donar', 'Registrar donación') + b('sobrante-por-devolver', 'Marcar por devolver')
    : c.sobranteEstado === 'por_devolver' ? b('sobrante-devuelto', 'Marcar devuelto', '') : '';
  return `
    <div class="kv" style="align-items:center">
      <span>Sobrante ${dinero(c.sobranteMonto)}: <span class="pill ${c.sobranteEstado === 'donado' || c.sobranteEstado === 'devuelto' ? 'enviado' : 'pendiente'}">${esc(ESTADO_SOBRANTE[c.sobranteEstado])}</span>
        <span class="muted">(${esc(ELECCION[c.sobranteDestino] ?? '')})</span>
        ${c.sobranteNota ? `<br><span class="muted">Cómo devolverlo: ${esc(c.sobranteNota)}</span>` : ''}
        ${c.sobranteResolucion ? `<br><span class="muted">${c.sobranteEstado === 'devuelto' ? 'Devuelto' : 'Nota'}: ${esc(c.sobranteResolucion)}</span>` : ''}</span>
      <span class="actions" style="margin:0">${botones}</span>
    </div>`;
}

async function renderSobrantes() {
  const lista = await api('GET', '/admin/sobrantes');
  const pend = lista.filter(c => c.sobranteEstado === 'por_definir' || c.sobranteEstado === 'por_devolver');
  const total = pend.reduce((s, c) => s + c.sobranteMonto, 0);
  $('vista').innerHTML = `
    <div class="note">Cuando alguien paga más de lo que valen sus tablas, el excedente queda aquí. Si el comprador lo donó, suma a los ingresos.
      Si pidió devolución, el dinero no cuenta como ingreso hasta que lo devuelvas y anotes cómo.</div>
    <div class="stats">
      <div class="card stat"><span class="muted">Pendiente de decidir o devolver</span><strong class="${total > 0 ? 'neg' : ''}">${dinero(total)}</strong></div>
      <div class="card stat"><span class="muted">Casos pendientes</span><strong>${pend.length}</strong></div>
    </div>
    <h2>Sobrantes</h2>
    ${lista.map(c => `<article class="card"><div class="row"><strong>${esc(c.nombre)}</strong><span class="muted">${esc(c.codigo)} · ${esc(c.telefono)}</span></div>
      <p class="muted">Pagó ${dinero(c.pagado)} · se enviaron ${c.tablasAprobadas ?? 0} tabla(s)</p>${filaSobrante(c)}</article>`).join('')
      || '<p class="muted">Aún no hay sobrantes.</p>'}`;
}

function botonesCompra(c) {
  const b = [];
  if (c.estado === 'por_verificar' || c.estado === 'verificada') {
    b.push(`<button type="button" class="danger" data-act="rechazar" data-id="${c.id}">Rechazar compra</button>`);
  }
  return b.join('');
}

// Al abrir la tarjeta de pagos, se carga el detalle de la compra.
async function cargarPagos(card) {
  const id = card.dataset.compra;
  const d = await api('GET', `/admin/compras/${id}`);
  const pagosHtml = d.pagos.map(p => `
    <div class="kv" style="flex-direction:column;align-items:flex-start">
      <div class="row" style="width:100%">
        <span>${esc(p.metodo)} · Ref. <span class="mono">${esc(p.referencia)}</span> · Pagó el ${esc(p.fechaPago || fecha(p.creadoEn))}</span>
        <span class="pill ${esc(p.estado)}">${esc(p.estado.replace('_', ' '))}</span>
      </div>
      <span class="muted">Reportado ${dinero(p.montoReportado)}${p.montoVerificado != null ? ` · Verificado ${dinero(p.montoVerificado)}` : ''}</span>
      ${p.comprobantes.map(c => `<button type="button" class="ghost" data-act="ver-comprobante" data-id="${c.id}">Ver ${esc(c.nombre)}</button>`).join('')}
      ${p.comprobantes.length === 0 && p.estado === 'por_verificar' ? '<span class="muted">Sin comprobante (pago en efectivo): confirma que recibiste el dinero.</span>' : ''}
      ${p.estado === 'por_verificar' ? `
        <div class="row" style="width:100%;margin-top:6px">
          <label style="flex:1 1 160px">Monto recibido
            <input type="number" min="0.01" step="0.01" value="${p.montoReportado}" data-monto="${p.id}" data-precio="${d.precioUnitario}">
            <span class="muted" data-calc="${p.id}">Equivale a ${Math.floor(p.montoReportado / d.precioUnitario + 1e-9)} tabla(s)</span>
          </label>
          <div class="actions">
            <button type="button" data-act="verificar-pago" data-id="${p.id}">Verificar pago</button>
            <button type="button" class="danger" data-act="rechazar-pago" data-id="${p.id}">Rechazar</button>
          </div>
        </div>` : ''}
    </div>`).join('') || '<p class="muted">Sin pagos.</p>';

  const manual = d.estado !== 'rechazada' ? `
    <form class="row" data-pago-manual="${d.id}" style="margin-top:10px">
      <label style="flex:1 1 120px">Monto <input name="monto" type="number" min="0.01" step="0.01" required></label>
      <label style="flex:1 1 120px">Método
        <select name="metodo"><option>Efectivo</option><option>Consignación</option><option>Transferencia</option></select>
      </label>
      <label style="flex:1 1 120px">Referencia <input name="referencia" maxlength="60"></label>
      <button type="submit" class="ghost">Registrar pago recibido</button>
    </form>` : '';
  card.querySelector('[data-pagos]').innerHTML = pagosHtml + manual;
}

// Al elegir cuántas tablas enviar se ve cuánto sobra y qué decidió el comprador.
function pintarSobranteEnvio(form) {
  const i = form.cantidad;
  const info = form.querySelector('[data-sobrante-info]');
  const sobra = Math.round((Number(i.dataset.pagado) - Number(i.value || 0) * Number(i.dataset.precio)) * 100) / 100;
  if (!(sobra > 0)) { info.textContent = sobra < 0 ? `Falta ${dinero(-sobra)} para cubrir esas tablas.` : 'Sin sobrante.'; return; }
  const eleccion = { donacion: 'quiso donarlo', devolucion: `pidió devolución${info.dataset.nota ? ` («${info.dataset.nota}»)` : ''}` }[info.dataset.eleccion] || 'no eligió qué hacer: tú decidirás después';
  info.textContent = `Sobran ${dinero(sobra)}; el comprador ${eleccion}.`;
}
$('vista').addEventListener('input', e => {
  const sf = e.target.closest('form[data-enviar]');
  if (sf && e.target.name === 'cantidad') pintarSobranteEnvio(sf);
});
new MutationObserver(() => document.querySelectorAll('form[data-enviar]').forEach(f => {
  if (!f.dataset.pintado) { f.dataset.pintado = '1'; pintarSobranteEnvio(f); }
})).observe($('vista'), { childList: true, subtree: true });

// Equivalencia en tablas mientras se escribe el monto recibido.
$('vista').addEventListener('input', e => {
  const i = e.target.closest('input[data-monto]');
  if (!i) return;
  const n = Math.floor(Number(i.value) / Number(i.dataset.precio) + 1e-9);
  const span = document.querySelector(`[data-calc="${i.dataset.monto}"]`);
  if (span) span.textContent = `Equivale a ${Number.isFinite(n) ? n : 0} tabla(s)`;
});

$('vista').addEventListener('click', async e => {
  const cp = e.target.closest('button[data-copiar]');
  if (cp) {
    try { await navigator.clipboard.writeText(cp.dataset.copiar); msg('Copiado.'); } catch { msg('No se pudo copiar. Selecciónalo y cópialo a mano.', true); }
    return;
  }
  const ir = e.target.closest('button[data-vista-ir]');
  if (ir) { filtroCompras = 'por_verificar'; return mostrar(ir.dataset.vistaIr); }
  const f = e.target.closest('button[data-filtro]');
  if (f) { filtroCompras = f.dataset.filtro; return mostrar('compras'); }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const canal = btn.dataset.canal;
  btn.disabled = true;
  try {
    if (act === 'ver-comprobante') {
      window.open(`/api/admin/comprobantes/${id}/archivo`, '_blank', 'noopener');
      return;
    }
    if (act === 'reenviar') {
      const r = await api('POST', `/admin/compras/${id}/reenviar`, { canales: { [canal]: true } });
      const estado = canal === 'correo' ? r.correoEstado : r.whatsappEstado;
      msg(estado === 'enviado' ? 'Enviado.' : 'No se pudo enviar automáticamente. Revisa el error o usa el envío manual.', estado !== 'enviado');
      return mostrar('compras');
    }
    if (act === 'enlace' || act === 'enlace-correo') {
      const { enlace } = await api('GET', `/admin/compras/${id}/${act === 'enlace' ? 'enlace-whatsapp' : 'enlace-correo'}`);
      window.open(enlace, '_blank', 'noopener');
      msg('Se abrió el mensaje. Envíalo y luego usa "Marcar enviado".');
    }
    if (act === 'marcar') {
      await api('POST', `/admin/compras/${id}/envio-manual`, { canal });
      msg('Marcado como enviado.');
      return mostrar('compras');
    }
    if (act === 'sobrante-donar' || act === 'sobrante-por-devolver' || act === 'sobrante-devuelto') {
      const accion = { 'sobrante-donar': 'donar', 'sobrante-por-devolver': 'por_devolver', 'sobrante-devuelto': 'devuelto' }[act];
      const pregunta = {
        donar: '¿Cómo autorizó el comprador la donación? (opcional, ej. "por WhatsApp")',
        por_devolver: '¿Cómo se le devolverá el dinero? (cuenta, llave, efectivo…)',
        devuelto: '¿Cómo se devolvió? (fecha, medio y referencia)',
      }[accion];
      const nota = prompt(pregunta);
      if (nota === null) return;
      await api('POST', `/admin/compras/${id}/sobrante`, { accion, nota });
      msg('Sobrante actualizado.');
      return mostrar(vistaActual);
    }
    if (act === 'fisica-pendiente') {
      await api('POST', `/admin/compras/${id}/entrega-fisica`, { estado: 'pendiente' });
      msg('Entrega física registrada como pendiente.');
      return mostrar('compras');
    }
    if (act === 'fisica-entregada') {
      const nota = prompt('¿Quién recibió las tablas y cuándo? (opcional)') ?? '';
      await api('POST', `/admin/compras/${id}/entrega-fisica`, { estado: 'entregada', nota });
      msg('Entrega física marcada como realizada.');
      return mostrar('compras');
    }
    if (act === 'rechazar') {
      if (!confirm('¿Rechazar esta compra? Sus tablas quedarán libres para otros compradores.')) return;
      await api('POST', `/admin/compras/${id}/rechazar`);
      msg('Compra rechazada.');
      return mostrar('compras');
    }
    if (act === 'verificar-pago') {
      const monto = Number(document.querySelector(`[data-monto="${id}"]`).value);
      await api('POST', `/admin/pagos/${id}/verificar`, { montoVerificado: monto });
      msg('Pago verificado. Ahora define cuántas tablas enviar y por qué canal.');
      filtroCompras = 'verificada';
      return mostrar('compras');
    }
    if (act === 'rechazar-pago') {
      if (!confirm('¿Rechazar este pago?')) return;
      await api('POST', `/admin/pagos/${id}/rechazar`);
      msg('Pago rechazado.');
      return mostrar('compras');
    }
  } catch (err) {
    msg(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// Carga los pagos al abrir el detalle de la compra.
$('vista').addEventListener('toggle', e => {
  const card = e.target.closest('[data-compra]');
  if (card && e.target.open && !card.dataset.cargado) {
    card.dataset.cargado = '1';
    cargarPagos(card).catch(err => msg(err.message, true));
  }
}, true);

$('vista').addEventListener('submit', async e => {
  const manual = e.target.closest('form[data-pago-manual]');
  if (manual) {
    e.preventDefault();
    try {
      await api('POST', `/admin/compras/${manual.dataset.pagoManual}/pagos`, {
        monto: manual.monto.value, metodo: manual.metodo.value, referencia: manual.referencia.value,
      });
      msg('Pago registrado.');
      mostrar('compras');
    } catch (err) {
      msg(err.message, true);
    }
    return;
  }
  const envio = e.target.closest('form[data-enviar]');
  if (!envio) return;
  e.preventDefault();
  const cantidad = Number(envio.cantidad.value);
  const canales = { whatsapp: envio.whatsapp.checked, correo: envio.correo.checked, fisica: envio.fisica.checked };
  if (!canales.whatsapp && !canales.correo && !canales.fisica) return msg('Elige al menos un canal de entrega.', true);
  if (!confirm(`¿Asignar ${cantidad} tabla(s) a ${envio.dataset.nombre} y enviarlas? Esta acción no se puede deshacer.`)) return;
  const boton = envio.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const r = await api('POST', `/admin/compras/${envio.dataset.enviar}/enviar`, { cantidad, canales });
    const partes = [];
    if (canales.whatsapp) partes.push(r.whatsappEstado === 'enviado' ? 'WhatsApp enviado' : r.whatsappEstado === 'manual' ? 'WhatsApp: usa "WhatsApp manual"' : 'WhatsApp falló');
    if (canales.correo) partes.push(r.correoEstado === 'enviado' ? 'correo enviado' : r.correoEstado === 'manual' ? 'correo: usa "Correo manual"' : 'correo falló');
    if (canales.fisica) partes.push('entrega física pendiente');
    const malo = (canales.whatsapp && r.whatsappEstado === 'fallido') || (canales.correo && r.correoEstado === 'fallido');
    msg(`Tablas asignadas: ${r.tablas.join(', ')}. ${partes.join(' · ')}.`, malo);
    filtroCompras = 'enviada';
    mostrar('compras');
  } catch (err) {
    msg(err.message, true);
    boton.disabled = false;
  }
});

// ---------- Tablas ----------
async function renderTablas() {
  const r = await api('GET', '/admin/resumen');
  $('vista').innerHTML = `
    <div class="stats">
      <div class="card stat"><span class="muted">Total</span><strong>${r.tablas.total}</strong></div>
      <div class="card stat"><span class="muted">Disponibles</span><strong>${r.tablas.disponibles}</strong></div>
      <div class="card stat"><span class="muted">Vendidas</span><strong>${r.tablas.vendidas}</strong></div>
    </div>
    <h2>Importar tablas existentes</h2>
    <form id="form-importar" class="card">
      <label>Seriales (uno por línea o separados por coma)
        <textarea name="seriales" rows="6" placeholder="1&#10;2&#10;3&#10;..."></textarea>
      </label>
      <div class="actions"><button type="submit">Importar</button></div>
    </form>
    <h2>Generar tablas nuevas</h2>
    <form id="form-generar" class="card row">
      <label style="flex:1 1 160px">Cantidad (1 a 500) <input name="cantidad" type="number" min="1" max="500" value="100"></label>
      <button type="submit">Generar</button>
    </form>
    <h2>Listado</h2>
    <div class="card"><div class="chips" id="chips">${(await api('GET', '/admin/tablas')).map(t => `<span class="chip ${t.estado === 'vendida' ? 'vendida' : ''}" title="${esc(t.compraCodigo || '')}">${esc(t.serial)}</span>`).join('')}</div></div>
    `;

  $('form-importar').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api('POST', '/admin/tablas/importar', { seriales: e.target.seriales.value });
      msg(`Leídas ${r.leidas} · Nuevas ${r.insertadas} · Repetidas ${r.repetidas}`);
      mostrar('tablas');
    } catch (err) { msg(err.message, true); }
  });
  $('form-generar').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api('POST', '/admin/tablas/generar', { cantidad: Number(e.target.cantidad.value) });
      msg(`Generadas ${r.creadas} tabla(s).`);
      mostrar('tablas');
    } catch (err) { msg(err.message, true); }
  });
}

// ---------- Premios ----------
async function renderPremios() {
  const premios = await api('GET', '/admin/premios');
  $('vista').innerHTML = `
    <h2>Nueva ronda</h2>
    <form id="form-premio" class="card">
      <div class="grid">
        <label>Ronda <input name="ronda" required maxlength="80" placeholder="Línea, Cartón lleno…"></label>
        <label>Premio <input name="premio" required maxlength="120"></label>
        <label>Monto <input name="monto" type="number" min="0" step="0.01" value="0"></label>
      </div>
      <div class="actions"><button type="submit">Crear ronda</button></div>
    </form>
    <h2>Rondas</h2>
    ${premios.map(p => `
      <article class="card">
        <div class="row"><strong>${esc(p.ronda)}</strong>
          <span class="pill ${p.pagado ? 'verificado' : p.serial ? 'por_verificar' : ''}">${p.pagado ? 'pagado' : p.serial ? 'pendiente de pago' : 'sin ganador'}</span></div>
        <p class="muted">${esc(p.premio)} · ${dinero(p.monto)}</p>
        ${p.serial ? `
          <p class="mono">${esc(p.serial)}</p>
          <p>${esc(p.ganador?.nombre ?? '')} · Cédula ${esc(p.ganador?.cedula ?? '')} · ${esc(p.ganador?.telefono ?? '')} ${p.ganador ? `(${esc(p.ganador.codigo)})` : ''}</p>
          <div class="actions">
            ${p.pagado ? '' : `<button type="button" data-premio-pagar="${p.id}">Marcar pagado</button>
            <button type="button" class="ghost" data-premio-quitar="${p.id}">Quitar ganador</button>`}
          </div>` : `
          <form class="row" data-premio-ganador="${p.id}" style="margin-top:8px">
            <label style="flex:1 1 200px">Serial ganador <input name="serial" required placeholder="BNG-XXXX-XXXX"></label>
            <button type="submit">Registrar ganador</button>
          </form>`}
      </article>`).join('') || '<p class="muted">Aún no hay rondas.</p>'}`;

  $('form-premio').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('POST', '/admin/premios', { ronda: e.target.ronda.value, premio: e.target.premio.value, monto: Number(e.target.monto.value) });
      msg('Ronda creada.');
      mostrar('premios');
    } catch (err) { msg(err.message, true); }
  });
  $('vista').querySelectorAll('form[data-premio-ganador]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('PUT', `/admin/premios/${f.dataset.premioGanador}/ganador`, { serial: f.serial.value });
      msg('Ganador registrado.');
      mostrar('premios');
    } catch (err) { msg(err.message, true); }
  }));
  $('vista').querySelectorAll('[data-premio-pagar]').forEach(b => b.addEventListener('click', () =>
    accion(async () => { await api('POST', `/admin/premios/${b.dataset.premioPagar}/pagar`); mostrar('premios'); }, 'Premio marcado como pagado.')));
  $('vista').querySelectorAll('[data-premio-quitar]').forEach(b => b.addEventListener('click', () =>
    accion(async () => { await api('DELETE', `/admin/premios/${b.dataset.premioQuitar}/ganador`); mostrar('premios'); }, 'Ganador quitado.')));
}

// ---------- Gastos ----------
async function renderGastos() {
  const gastos = await api('GET', '/admin/gastos');
  const total = gastos.reduce((s, g) => s + g.monto, 0);
  $('vista').innerHTML = `
    <h2>Registrar gasto</h2>
    <form id="form-gasto" class="card">
      <div class="grid">
        <label>Concepto <input name="concepto" required maxlength="120"></label>
        <label>Monto <input name="monto" type="number" min="0.01" step="0.01" required></label>
        <label>Categoría
          <select name="categoria"><option>Logística</option><option>Impresión</option><option>Publicidad</option><option>Premios</option><option>Otros</option></select>
        </label>
        <label>Fecha <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      </div>
      <div class="actions"><button type="submit">Registrar</button></div>
    </form>
    <h2>Gastos (${dinero(total)})</h2>
    <div class="card">
      ${gastos.map(g => `<div class="kv"><span>${esc(g.fecha)} · ${esc(g.concepto)} <span class="muted">(${esc(g.categoria)})</span></span>
        <span><strong>${dinero(g.monto)}</strong> <button type="button" class="danger" data-gasto-borrar="${g.id}">Borrar</button></span></div>`).join('') || '<p class="muted">Sin gastos.</p>'}
    </div>`;

  $('form-gasto').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/admin/gastos', { concepto: f.concepto.value, monto: Number(f.monto.value), categoria: f.categoria.value, fecha: f.fecha.value });
      msg('Gasto registrado.');
      mostrar('gastos');
    } catch (err) { msg(err.message, true); }
  });
  $('vista').querySelectorAll('[data-gasto-borrar]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('¿Borrar este gasto?')) return;
    accion(async () => { await api('DELETE', `/admin/gastos/${b.dataset.gastoBorrar}`); mostrar('gastos'); }, 'Gasto borrado.');
  }));
}

// ---------- Configuración ----------
async function renderConfig() {
  const e = await api('GET', '/admin/evento');
  let qr = e.qrPago; // '' = sin QR; solo se envía si el administrador lo cambia
  let qrCambiado = false;
  $('vista').innerHTML = `
    <form id="form-config">
      <div class="card">
        <h2 style="margin-top:0">Evento</h2>
        <div class="grid">
          <label>Nombre del evento <input name="nombre" value="${esc(e.nombre)}" maxlength="120"></label>
          <label>Precio por tabla <input name="precioTabla" type="number" min="0" step="any" value="${e.precioTabla}" required></label>
          <label>Moneda (símbolo o texto) <input name="moneda" value="${esc(e.moneda)}" maxlength="10" placeholder="$, COP"></label>
          <label>Fecha del sorteo <input name="fechaSorteo" type="date" value="${esc(e.fechaSorteo)}"></label>
        </div>
        <p class="muted">Con el precio en 0 las compras quedan cerradas. Al cambiarlo, solo afecta las compras nuevas.</p>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Datos de pago que ve el comprador</h2>
        <div class="grid">
          <label>Titular de la cuenta <input name="titularCuenta" value="${esc(e.titularCuenta)}" maxlength="120"></label>
          <label>Banco <input name="banco" value="${esc(e.banco)}" maxlength="80" placeholder="Ej. Bancolombia"></label>
          <label>Tipo de cuenta
            <select name="tipoCuenta">
              ${['', 'Ahorros', 'Corriente'].map(t => `<option value="${t}" ${e.tipoCuenta === t ? 'selected' : ''}>${t || '(sin indicar)'}</option>`).join('')}
            </select>
          </label>
          <label>Número de cuenta <input name="numeroCuenta" value="${esc(e.numeroCuenta)}" maxlength="40" inputmode="numeric"></label>
          <label class="full">Llave (para transferencias desde otros bancos)
            <input name="llavePago" value="${esc(e.llavePago)}" maxlength="80" placeholder="Número de celular, correo o código de la llave">
            <span class="muted" style="font-weight:400">El comprador la escribe en su app en lugar del número de cuenta.</span>
          </label>
          <label class="full">Instrucciones adicionales <span class="opc">(opcional)</span>
            <textarea name="cuentasPago" rows="3" maxlength="2000">${esc(e.cuentasPago)}</textarea>
          </label>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Código QR de pago</h2>
        <p class="muted" style="margin-top:-6px">Sube la imagen del QR que te dio el banco (PNG, JPG o WEBP, máximo 400 KB). El comprador lo escanea con su app y lo lleva directo al pago.</p>
        <div id="qr-vista" style="margin:10px 0"></div>
        <input type="file" id="qr-archivo" accept="image/png,image/jpeg,image/webp">
        <div class="actions"><button type="button" class="ghost danger" id="qr-quitar">Quitar QR</button></div>
      </div>

      <div class="card">
        <label class="full" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" name="exigirPagoCompleto" style="width:auto" ${e.exigirPagoCompleto ? 'checked' : ''}>
          Exigir que el pago verificado cubra las tablas que se envían (recomendado: nunca se entregan tablas sin pagar)
        </label>
      </div>
      <div class="actions"><button type="submit" class="grande">Guardar configuración</button></div>
    </form>`;

  const pintarQr = () => {
    $('qr-vista').innerHTML = qr
      ? `<img src="${esc(qr)}" alt="QR de pago" style="max-width:220px;width:100%;border-radius:12px;border:1px solid var(--line);background:#fff">`
      : '<p class="muted">Aún no hay un QR cargado.</p>';
    $('qr-quitar').hidden = !qr;
  };
  pintarQr();

  $('qr-archivo').addEventListener('change', ev => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) { ev.target.value = ''; return msg('El QR debe ser PNG, JPG o WEBP.', true); }
    if (archivo.size > 400 * 1024) { ev.target.value = ''; return msg('El QR pesa más de 400 KB. Reduce la imagen.', true); }
    const lector = new FileReader();
    lector.onload = () => { qr = lector.result; qrCambiado = true; pintarQr(); msg('QR listo. Pulsa "Guardar configuración".'); };
    lector.readAsDataURL(archivo);
  });
  $('qr-quitar').addEventListener('click', () => { qr = ''; qrCambiado = true; $('qr-archivo').value = ''; pintarQr(); });

  $('form-config').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('PUT', '/admin/evento', {
        nombre: f.nombre.value,
        precioTabla: Number(f.precioTabla.value),
        moneda: f.moneda.value,
        fechaSorteo: f.fechaSorteo.value,
        titularCuenta: f.titularCuenta.value,
        banco: f.banco.value,
        tipoCuenta: f.tipoCuenta.value,
        numeroCuenta: f.numeroCuenta.value,
        llavePago: f.llavePago.value,
        cuentasPago: f.cuentasPago.value,
        exigirPagoCompleto: f.exigirPagoCompleto.checked,
        ...(qrCambiado ? { qrPago: qr } : {}),
      });
      await entrar();
      msg('Configuración guardada.');
    } catch (err) { msg(err.message, true); }
  });
}

// ---------- Reportes ----------
function renderReportes() {
  const reportes = [
    ['compras', 'Compras con pagado, saldo y seriales'],
    ['pagos', 'Todos los pagos reportados y verificados'],
    ['deudas', 'Quién debe cuánto'],
    ['sobrantes', 'Sobrantes: donaciones y devoluciones'],
    ['tablas', 'Cada tabla: disponible o vendida, y a quién'],
    ['premios', 'Rondas, ganadores y pagos'],
    ['gastos', 'Gastos del evento'],
  ];
  $('vista').innerHTML = `<div class="card">${reportes.map(([k, t]) =>
    `<div class="kv"><span>${esc(t)}</span><a class="btn ghost" href="/api/admin/reportes/${k}.csv">Descargar CSV</a></div>`).join('')}</div>
    <p class="muted">Los CSV se abren en Excel. Cada descarga es un corte en el momento que la pides.</p>`;
}

// ---------- Bitácora ----------
async function renderBitacora() {
  const filas = await api('GET', '/admin/bitacora');
  $('vista').innerHTML = `<div class="card">${filas.map(b =>
    `<div class="kv"><span>${esc(fecha(b.fecha))} · ${esc(b.accion)}</span><span class="muted">${esc(b.detalle)}</span></div>`).join('') || '<p class="muted">Sin movimientos.</p>'}</div>`;
}

// Arranque: si la sesión sigue viva, entra directo.
(async () => {
  try {
    await api('GET', '/admin/resumen');
    await entrar();
  } catch {
    mostrarLogin();
  }
})();
