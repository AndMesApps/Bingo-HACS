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
  transacciones: { titulo: 'Transacciones', render: renderTransacciones },
  sobrantes: { titulo: 'Sobrantes', render: renderSobrantes },
  tablas: { titulo: 'Tablas', render: renderTablas },
  sorteo: { titulo: 'Sorteo', render: renderSorteo },
  premios: { titulo: 'Premios', render: renderPremios },
  gastos: { titulo: 'Gastos', render: renderGastos },
  config: { titulo: 'Configuración', render: renderConfig },
  informes: { titulo: 'Informes', render: renderInformes },
  reportes: { titulo: 'Reportes', render: renderReportes },
  bingos: { titulo: 'Bingos', render: renderBingos },
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
// Envía la imagen de invitación junto con el texto y el enlace. En el celular abre el menú de compartir (WhatsApp, etc.);
// donde el navegador no puede compartir archivos (PC), descarga la imagen y copia el texto para pegarlo en WhatsApp Web.
async function compartirPieza(texto) {
  const blob = await (await fetch('/api/publico/invitacion.jpg')).blob();
  const archivo = new File([blob], 'invitacion-bingo.jpg', { type: blob.type || 'image/jpeg' });
  if (navigator.canShare?.({ files: [archivo] })) {
    const copiado = await copiarRespaldo(texto);
    try { await navigator.share({ files: [archivo], text: texto }); } catch (err) { if (err.name !== 'AbortError') throw err; }
    if (copiado) msg('Si WhatsApp no trae el texto junto a la imagen, pégalo: ya quedó copiado.');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'invitacion-bingo.jpg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  try { await navigator.clipboard.writeText(texto); } catch { /* el usuario puede copiar el texto aparte */ }
  msg('Se descargó la imagen y se copió el texto. En WhatsApp adjunta la imagen y pega el texto.');
}

// Copia de respaldo del texto: algunos celulares abren WhatsApp con la imagen pero sin el texto.
async function copiarRespaldo(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

async function renderResumen() {
  const r = await api('GET', '/admin/resumen');
  const d = r.dinero;
  const t = r.tablas;
  const enlace = location.origin + '/';
  // Texto configurable por Bingo; el enlace siempre va incluido (si el texto no lo trae, se agrega en una línea aparte).
  const personal = (r.evento.textoInvitacion || '').trim();
  const invitacion = personal
    ? (personal.includes(enlace) ? personal : `${personal}\n\n${enlace}`)
    : `Te invitamos a ${r.evento.nombre || 'nuestro bingo'} de las Hermanas Auxiliadoras de Cristo Sacerdote. Compra tus tablas aquí: ${enlace}`;
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
      <h3 style="margin:18px 0 6px">Invitación con imagen y texto</h3>
      <p class="muted" style="margin-top:0">Con el botón se envían juntos la imagen, el texto y el enlace. Los cambias en Configuración. Al pegar solo el enlace, WhatsApp muestra la imagen como vista previa.</p>
      <pre class="invitacion-texto">${esc(invitacion)}</pre>
      ${r.evento.pieza === 'ninguna'
        ? '<p class="muted">Este Bingo todavía no tiene imagen de invitación. Súbela en Configuración.</p>'
        : `<div class="row" style="flex-wrap:nowrap;gap:14px;align-items:flex-start">
            <a href="/api/publico/invitacion.jpg" target="_blank" rel="noopener"><img src="/api/publico/invitacion.jpg?v=${Date.now()}" alt="Imagen de invitación"
              style="width:150px;border-radius:10px;border:1px solid var(--line)"></a>
            <div class="actions" style="margin-top:0">
              <button type="button" id="compartir-pieza" data-texto="${esc(invitacion)}">Compartir imagen y enlace</button>
              <a class="btn ghost" href="/api/publico/invitacion.jpg" download="invitacion-bingo.jpg">Descargar imagen</a>
            </div>
          </div>`}
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
    ? `Donación sin tablas · Verificado ${dinero(c.pagado)} · con su pago le corresponderían ${c.estado === 'donacion' ? c.tablasSugeridas : c.tablasReportadas} tabla(s)`
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
  // Cambio de opinión de quien donó sin tablas: pasa a ser una compra normal y se le pueden enviar.
  if (c.cantidad === 0 && (c.estado === 'por_verificar' || c.estado === 'donacion')) {
    const sugeridas = c.estado === 'donacion' ? c.tablasSugeridas : c.tablasReportadas;
    if (sugeridas >= 1) {
      b.push(`<button type="button" data-act="donacion-a-compra" data-id="${c.id}" data-sugeridas="${sugeridas}" data-estado="${c.estado}">Quiere sus tablas (cambiar la donación)</button>`);
    }
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
  const compartir = e.target.closest('#compartir-pieza');
  if (compartir) { compartir.disabled = true; try { await compartirPieza(compartir.dataset.texto); } catch (err) { msg(err.message, true); } compartir.disabled = false; return; }
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
    if (act === 'donacion-a-compra') {
      const sugeridas = Number(btn.dataset.sugeridas);
      const texto = prompt(`Esta persona donó sin tablas. ¿Cuántas tablas se le enviarán? (su pago cubre hasta ${sugeridas})`, String(sugeridas));
      if (texto === null) return;
      await api('POST', `/admin/compras/${id}/convertir-donacion`, { cantidad: Number(texto) });
      filtroCompras = btn.dataset.estado === 'donacion' ? 'verificada' : 'por_verificar';
      msg(btn.dataset.estado === 'donacion'
        ? 'Listo: la compra quedó en "Listas para enviar". Envíale las tablas desde ahí.'
        : 'Listo: la compra quedó por verificar como una compra normal.');
      return mostrar('compras');
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
  const tablasLista = await api('GET', '/admin/tablas');
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
    <p class="muted">Toca una tabla para ver a quién se le vendió. Las tachadas están vendidas.</p>
    <input type="search" id="tabla-buscar" placeholder="Buscar por número de tabla, nombre, celular o código" aria-label="Buscar tablas" style="margin-bottom:12px">
    <div id="tabla-detalle" class="card" hidden></div>
    <div class="card"><div class="chips" id="chips">${tablasLista.map(t => `<button type="button" class="chip ${t.estado === 'vendida' ? 'vendida' : ''}" data-tabla="${esc(t.serial)}"
      data-texto="${esc([t.serial, t.compraNombre, t.compraTelefono, t.compraCodigo].filter(Boolean).join(' ').toLowerCase())}"
      title="${t.estado === 'vendida' ? esc('Vendida a ' + t.compraNombre) : 'Disponible'}">${esc(t.serial)}</button>`).join('')}</div></div>
    `;

  // Buscar y abrir el detalle de una tabla: si está vendida, a quién y con qué datos.
  $('tabla-buscar').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $('chips').querySelectorAll('.chip').forEach(c => { c.hidden = Boolean(q) && !c.dataset.texto.includes(q); });
  });
  $('chips').addEventListener('click', async e => {
    const chip = e.target.closest('[data-tabla]');
    if (!chip) return;
    const t = tablasLista.find(x => x.serial === chip.dataset.tabla);
    const caja = $('tabla-detalle');
    caja.hidden = false;
    if (t.estado !== 'vendida') {
      caja.innerHTML = `<h3 style="margin:0">Tabla ${esc(t.serial)}</h3><p class="muted">Disponible: todavía no se ha vendido.</p>`;
      return caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    caja.textContent = 'Cargando…';
    try {
      const d = await api('GET', `/admin/compras/${t.compraId}`);
      const kv = (k, v) => (v === '' || v == null ? '' : `<div class="kv"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`);
      caja.innerHTML = `
        <div class="row"><h3 style="margin:0">Tabla ${esc(t.serial)} · vendida a ${esc(d.nombre)}</h3>
          <button type="button" class="ghost" data-cerrar-tabla>Cerrar</button></div>
        ${kv('Celular', d.telefono)}${kv('Cédula', d.cedula)}${kv('Correo', d.correo)}${kv('Ciudad', d.ciudad)}
        ${kv('Se enteró por', d.referidoPor)}${kv('Código de compra', d.codigo)}${kv('Vendida el', fecha(t.vendidaEn))}
        ${kv('Estado de la compra', d.estado.replace('_', ' '))}
        <p class="muted" style="margin:10px 0 4px">Tablas de esta compra (${d.tablas.length})</p>
        <div class="tx-chips">${d.tablas.map(s => `<span class="mono" ${s === t.serial ? 'style="border-color:var(--accent);font-weight:700"' : ''}>${esc(s)}</span>`).join('')}</div>
        <div class="actions"><button type="button" class="ghost" data-ver-transaccion="${esc(d.codigo)}">Ver la transacción</button></div>`;
      caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) { caja.textContent = err.message; }
  });
  $('tabla-detalle').addEventListener('click', e => {
    if (e.target.closest('[data-cerrar-tabla]')) $('tabla-detalle').hidden = true;
    const v = e.target.closest('[data-ver-transaccion]');
    if (v) { filtroTx = ''; busquedaTx = v.dataset.verTransaccion; mostrar('transacciones'); }
  });

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
  const [premios, { figuras }] = await Promise.all([api('GET', '/admin/premios'), api('GET', '/admin/sorteo')]);
  $('vista').innerHTML = `
    <h2>Nueva ronda</h2>
    <form id="form-premio" class="card">
      <div class="grid">
        <label>Ronda <input name="ronda" required maxlength="80" placeholder="Línea, Cartón lleno…"></label>
        <label>Premio <input name="premio" required maxlength="120"></label>
        <label>Monto <input name="monto" type="number" min="0" step="0.01" value="0"></label>
        <label>Figura que gana <select name="figura">${figuras.map(f => `<option value="${f.id}" ${f.id === 'carton_lleno' ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select></label>
      </div>
      <div class="actions"><button type="submit">Crear ronda</button></div>
    </form>
    <h2>Rondas</h2>
    ${premios.map(p => `
      <article class="card">
        <div class="row"><strong>${esc(p.ronda)}</strong>
          <span class="pill ${p.pagado ? 'verificado' : p.serial ? 'por_verificar' : ''}">${p.pagado ? 'entregado' : p.serial ? 'por entregar' : 'sin ganador'}</span></div>
        <p class="muted">${esc(p.premio)} · ${dinero(p.monto)} · ${esc(p.figuraNombre)}</p>
        ${p.serial ? `
          <p class="mono">${esc(p.serial)}</p>
          <p>${esc(p.ganador?.nombre ?? '')} · Cédula ${esc(p.ganador?.cedula ?? '')} · ${esc(p.ganador?.telefono ?? '')} ${p.ganador ? `(${esc(p.ganador.codigo)})` : ''}</p>
          <div class="actions">
            ${p.pagado ? '' : `<button type="button" class="ghost" data-premio-quitar="${p.id}">Quitar ganador</button>`}
          </div>
          ${p.pagado ? `<p class="muted">Entregado${p.recibidoPor ? ` a ${esc(p.recibidoPor)}` : ''}${p.entregaNota ? ` · ${esc(p.entregaNota)}` : ''}</p>` : `
          <form class="row" data-premio-pagar="${p.id}" style="margin-top:8px">
            <label style="flex:1 1 220px">Quién lo recibe (nombre y documento) <input name="recibidoPor" required maxlength="160"></label>
            <label style="flex:1 1 200px">Nota <input name="nota" maxlength="500" placeholder="Opcional"></label>
            <button type="submit">Marcar entregado</button>
          </form>`}` : `
          <form class="row" data-premio-ganador="${p.id}" style="margin-top:8px">
            <label style="flex:1 1 200px">Serial ganador <input name="serial" required placeholder="BNG-XXXX-XXXX"></label>
            <button type="submit">Registrar ganador</button>
          </form>`}
      </article>`).join('') || '<p class="muted">Aún no hay rondas.</p>'}`;

  $('form-premio').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('POST', '/admin/premios', { ronda: e.target.ronda.value, premio: e.target.premio.value, monto: Number(e.target.monto.value), figura: e.target.figura.value });
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
  $('vista').querySelectorAll('form[data-premio-pagar]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('POST', `/admin/premios/${f.dataset.premioPagar}/pagar`, { recibidoPor: f.recibidoPor.value, nota: f.nota.value });
      msg('Entrega del premio registrada.');
      mostrar('premios');
    } catch (err) { msg(err.message, true); }
  }));
  $('vista').querySelectorAll('[data-premio-quitar]').forEach(b => b.addEventListener('click', () =>
    accion(async () => { await api('DELETE', `/admin/premios/${b.dataset.premioQuitar}/ganador`); mostrar('premios'); }, 'Ganador quitado.')));
}

// ---------- Sorteo en vivo ----------
async function renderSorteo() {
  const [estado, premios] = await Promise.all([api('GET', '/admin/sorteo'), api('GET', '/admin/premios')]);
  const { ronda, balotas } = estado;
  const LETRAS = ['B', 'I', 'N', 'G', 'O'];

  if (!ronda) {
    const disponibles = premios.filter(p => !p.serial);
    $('vista').innerHTML = `
      <h2>Sorteo</h2>
      ${disponibles.length ? `
      <form id="form-iniciar" class="card">
        <label>Ronda que se va a jugar
          <select name="ronda">${disponibles.map(p => `<option value="${p.id}">${esc(p.ronda)} — ${esc(p.premio)} (${esc(p.figuraNombre)})</option>`).join('')}</select>
        </label>
        <div class="actions"><button type="submit" class="grande">Iniciar ronda</button></div>
      </form>` : '<p class="muted">No hay rondas pendientes. Crea una en la pestaña Premios.</p>'}`;
    const f = $('form-iniciar');
    if (f) f.addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('POST', `/admin/premios/${f.ronda.value}/iniciar`); mostrar('sorteo'); } catch (err) { msg(err.message, true); }
    });
    return;
  }

  const cantadas = new Set(balotas);
  const ultima = balotas[balotas.length - 1];
  const fila = (letra, i) => `<div class="balotas-fila"><strong class="balotas-letra">${letra}</strong>${
    Array.from({ length: 15 }, (_, k) => i * 15 + k + 1).map(n =>
      `<button type="button" class="balota${cantadas.has(n) ? ' cantada' : ''}${n === ultima ? ' ultima' : ''}" data-balota="${n}" ${cantadas.has(n) ? 'disabled' : ''}>${n}</button>`).join('')}</div>`;

  $('vista').innerHTML = `
    <div class="row"><h2 style="margin:0">${esc(ronda.ronda)} · ${esc(ronda.premio)}</h2>
      <span class="pill por_verificar">en juego</span></div>
    <p class="muted">Figura: <strong>${esc(ronda.figuraNombre)}</strong> · Balotas cantadas: ${balotas.length} de 75</p>
    <div class="card">
      <p style="font-size:1.4rem;margin:0 0 10px">Última balota: <strong>${ultima ? `${LETRAS[Math.floor((ultima - 1) / 15)]}-${ultima}` : '—'}</strong></p>
      <div class="balotas">${LETRAS.map(fila).join('')}</div>
      <div class="actions">
        <button type="button" class="ghost" id="deshacer" ${ultima ? '' : 'disabled'}>Deshacer última balota</button>
        <button type="button" class="ghost" id="pausar">Pausar ronda</button>
      </div>
    </div>
    <h2>¡Alguien cantó Bingo!</h2>
    <form id="form-verificar" class="card row">
      <label style="flex:1 1 200px">Número de la tabla <input name="serial" required autocomplete="off" inputmode="numeric"></label>
      <button type="submit" class="grande">Verificar tabla</button>
    </form>
    <div id="resultado"></div>`;

  $('vista').querySelectorAll('[data-balota]').forEach(b => b.addEventListener('click', async () => {
    try { await api('POST', `/admin/premios/${ronda.id}/balotas`, { numero: Number(b.dataset.balota) }); mostrar('sorteo'); } catch (err) { msg(err.message, true); }
  }));
  $('deshacer').addEventListener('click', () => accion(async () => { await api('DELETE', `/admin/premios/${ronda.id}/balotas/${ultima}`); mostrar('sorteo'); }, 'Balota deshecha.'));
  $('pausar').addEventListener('click', () => accion(async () => { await api('POST', `/admin/premios/${ronda.id}/pausar`); mostrar('sorteo'); }, 'Ronda en pausa.'));

  $('form-verificar').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const v = await api('POST', `/admin/premios/${ronda.id}/verificar-tabla`, { serial: e.target.serial.value });
      const cuadricula = v.numeros ? `<div class="tabla-bingo">${LETRAS.map(l => `<strong>${l}</strong>`).join('')}${
        v.numeros.map((n, i) => `<span class="${v.marcadas[i] ? 'marcada' : ''}">${n === 0 ? '★' : n}</span>`).join('')}</div>` : '';
      $('resultado').innerHTML = `
        <article class="card">
          <div class="row"><strong>Tabla ${esc(v.serial)}</strong>
            <span class="pill ${v.cumple ? 'verificado' : 'rechazado'}">${v.cumple ? 'GANADORA' : 'no gana'}</span></div>
          <p>${esc(v.motivo)}</p>
          ${v.comprador ? `<p class="muted">${esc(v.comprador.nombre)} · ${esc(v.comprador.telefono)} · ${esc(v.comprador.codigo)}</p>` : ''}
          ${cuadricula}
          ${v.cumple ? '<div class="actions"><button type="button" class="grande" id="asignar">Asignar premio a esta tabla</button></div>' : ''}
        </article>`;
      const a = $('asignar');
      if (a) a.addEventListener('click', () => accion(async () => {
        await api('PUT', `/admin/premios/${ronda.id}/ganador`, { serial: v.serial });
        msg('Premio asignado. Registra la entrega en la pestaña Premios.');
        mostrar('premios');
      }, null));
    } catch (err) { $('resultado').innerHTML = ''; msg(err.message, true); }
  });
}

// ---------- Informes ----------
// Filtros que se recuerdan mientras la pestaña esté abierta.
const filtroInformes = { bingo: '', desde: '', hasta: '' };

async function renderInformes() {
  const { actual, historico } = await api('GET', '/admin/bingos');
  const params = new URLSearchParams();
  if (filtroInformes.bingo) params.set('bingo', filtroInformes.bingo);
  if (filtroInformes.desde) params.set('desde', filtroInformes.desde);
  if (filtroInformes.hasta) params.set('hasta', filtroInformes.hasta);
  const i = await api('GET', `/admin/informes${params.toString() ? '?' + params : ''}`);
  const m = i.resultados;
  const ESTADO_PAGO = { verificado: 'Verificados', por_verificar: 'Por verificar', rechazado: 'Rechazados' };
  const ESTADO_CANAL = { no_enviado: 'No enviado', enviado: 'Enviado', manual: 'Manual pendiente', fallido: 'Fallido', no: 'No aplica', pendiente: 'Pendiente', entregada: 'Entregada' };

  // Cada sección se dibuja como tabla y puede bajarse en CSV (con el mismo contenido que se ve).
  const secciones = [];
  const tabla = (id, titulo, encabezados, filas, pie, esDinero = h => h === 'Valor') => {
    secciones.push({ id, titulo, encabezados, filas });
    const cuerpo = filas.length
      ? filas.map(f => `<tr>${f.map((c, k) => typeof c === 'number' ? `<td class="num">${esc(esDinero(encabezados[k]) ? dinero(c) : c)}</td>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${encabezados.length}" class="muted">Sin datos en este rango.</td></tr>`;
    return `<section class="informe-seccion"><div class="row"><h3>${esc(titulo)}</h3>
      <button type="button" class="ghost no-print" data-csv="${id}">Descargar CSV</button></div>
      <div class="tabla-scroll"><table class="informe"><thead><tr>${encabezados.map(e => `<th>${esc(e)}</th>`).join('')}</tr></thead>
      <tbody>${cuerpo}</tbody>${pie ? `<tfoot><tr>${pie.map(c => `<td>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table></div></section>`;
  };
  const d = n => dinero(n);
  const suma = (arr, k) => arr.reduce((t, x) => t + (x[k] || 0), 0);

  const resultadosFilas = [
    ['Cobrado (pagos verificados)', m.cobrado],
    ['(−) Sobrantes por devolver', -m.porDevolver],
    ['(−) Sobrantes ya devueltos', -m.devuelto],
    ['Ingresos del Bingo', m.ingresos],
    ['   de los cuales: ventas de tablas', m.ventasTablas],
    ['   de los cuales: donaciones', m.donaciones],
    ['(−) Premios entregados', -m.premiosPagados],
    ['(−) Gastos', -m.gastos],
    ['EXCEDENTE NETO', m.excedente],
    ['(−) Premios aún por entregar', -m.premiosPendientes],
    ['Excedente proyectado', m.excedenteProyectado],
  ];
  secciones.push({ id: 'resultados', titulo: 'Estado de resultados', encabezados: ['Concepto', 'Valor'], filas: resultadosFilas });

  const cajaEnc = ['Día', ...i.caja.metodos, 'Total del día', 'Pagos'];
  const cajaFilas = i.caja.dias.map(x => [x.dia, ...i.caja.metodos.map(mt => x.porMetodo[mt] || 0), x.total, x.pagos]);
  const cajaPie = i.caja.dias.length ? ['Total', ...i.caja.metodos.map(mt => d(i.caja.dias.reduce((t, x) => t + (x.porMetodo[mt] || 0), 0))), d(suma(i.caja.dias, 'total')), String(suma(i.caja.dias, 'pagos'))] : null;

  const listaEstados = (arr, mapa) => arr.map(x => [mapa[x.clave] || x.clave, x.cantidad]);
  const periodo = i.desde || i.hasta ? `${i.desde || 'inicio'} a ${i.hasta || 'hoy'}` : 'todo el Bingo';

  $('vista').innerHTML = `
    <div class="no-print">
      <h2>Informes</h2>
      <form id="form-informes" class="card row" style="align-items:flex-end">
        <label>Bingo <select name="bingo"><option value="">${esc(actual.nombre)} (actual)</option>${
          historico.map(b => `<option value="${b.id}" ${String(b.id) === String(filtroInformes.bingo) ? 'selected' : ''}>${esc(b.nombre)} (cerrado)</option>`).join('')}</select></label>
        <label>Desde <input type="date" name="desde" value="${esc(filtroInformes.desde)}"></label>
        <label>Hasta <input type="date" name="hasta" value="${esc(filtroInformes.hasta)}"></label>
        <button type="submit">Ver informe</button>
        <button type="button" class="ghost" id="limpiar-filtros">Quitar filtros</button>
        <button type="button" class="ghost" id="imprimir">Imprimir / guardar PDF</button>
      </form>
    </div>
    <div class="informe-encabezado"><h2 style="margin:0">Informe del Bingo — ${esc(i.bingo.nombre)}</h2>
      <p class="muted">Periodo: ${esc(periodo)} · Generado el ${esc(new Date().toLocaleString('es'))}</p></div>

    <section class="informe-seccion"><h3>Estado de resultados</h3>
      <div class="tabla-scroll"><table class="informe"><tbody>${resultadosFilas.map(([c, v], k) => `<tr class="${[3, 8, 10].includes(k) ? 'total' : ''}"><td>${esc(c)}</td><td class="num">${esc(d(v))}</td></tr>`).join('')}</tbody></table></div>
      <div class="actions no-print"><button type="button" class="ghost" data-csv="resultados">Descargar CSV</button></div>
      <p class="muted">Cobrado = pagos verificados cuya fecha de pago cae en el periodo. Los premios pendientes no dependen del periodo.</p></section>

    ${tabla('caja', 'Caja por día y método de pago (pagos verificados)', cajaEnc, cajaFilas, cajaPie, h => h !== 'Día' && h !== 'Pagos')}
    ${tabla('pagos', 'Estado de los pagos', ['Estado', 'Cantidad', 'Valor'], i.pagosEstado.map(x => [ESTADO_PAGO[x.clave] || x.clave, x.cantidad, x.monto]))}
    ${tabla('ventas-dia', 'Ventas por día (tablas enviadas)', ['Día', 'Compras', 'Tablas', 'Valor'], i.ventasPorDia.map(x => [x.clave, x.compras, x.tablas, x.monto]),
      ['Total', String(suma(i.ventasPorDia, 'compras')), String(suma(i.ventasPorDia, 'tablas')), d(suma(i.ventasPorDia, 'monto'))])}
    ${tabla('referidos', 'Ventas por referido (quién trajo al benefactor)', ['Referido por', 'Compras', 'Tablas', 'Valor'], i.porReferido.map(x => [x.clave, x.compras, x.tablas, x.monto]))}
    ${tabla('ciudades', 'Ventas por ciudad', ['Ciudad', 'Compras', 'Tablas', 'Valor'], i.porCiudad.map(x => [x.clave, x.compras, x.tablas, x.monto]))}
    ${tabla('gastos', 'Gastos por categoría', ['Categoría', 'Registros', 'Valor'], i.gastosPorCategoria.map(x => [x.clave, x.cantidad, x.monto]),
      ['Total', String(suma(i.gastosPorCategoria, 'cantidad')), d(suma(i.gastosPorCategoria, 'monto'))])}
    ${tabla('premios', 'Premios', ['Ronda', 'Premio', 'Figura', 'Valor', 'Tabla', 'Ganador', 'Estado', 'Recibió'],
      i.premios.map(x => [x.ronda, x.premio, x.figura, x.monto, x.serial, x.ganador, x.estado, x.recibidoPor]))}

    <section class="informe-seccion"><h3>Control de tablas y entregas</h3>
      <div class="grid">
        <div class="card stat"><span class="muted">Vendidas</span><strong>${i.tablas.vendidas}</strong></div>
        ${i.tablas.disponibles == null ? '' : `<div class="card stat"><span class="muted">Disponibles</span><strong>${i.tablas.disponibles}</strong></div>`}
        <div class="card stat"><span class="muted">Por enviar</span><strong>${i.tablas.porEnviar}</strong></div>
      </div>
      ${tabla('entregas', 'Entregas por canal (compras con tablas enviadas)', ['Canal', 'Estado', 'Compras'], [
        ...listaEstados(i.tablas.whatsapp, ESTADO_CANAL).map(([e, n]) => ['WhatsApp', e, n]),
        ...listaEstados(i.tablas.correo, ESTADO_CANAL).map(([e, n]) => ['Correo', e, n]),
        ...listaEstados(i.tablas.fisica, ESTADO_CANAL).map(([e, n]) => ['Entrega física', e, n]),
      ])}
    </section>`;

  const f = $('form-informes');
  f.addEventListener('submit', e => {
    e.preventDefault();
    Object.assign(filtroInformes, { bingo: f.bingo.value, desde: f.desde.value, hasta: f.hasta.value });
    mostrar('informes');
  });
  $('limpiar-filtros').addEventListener('click', () => { Object.assign(filtroInformes, { bingo: '', desde: '', hasta: '' }); mostrar('informes'); });
  $('imprimir').addEventListener('click', () => window.print());
  $('vista').querySelectorAll('[data-csv]').forEach(b => b.addEventListener('click', () => {
    const s = secciones.find(x => x.id === b.dataset.csv);
    const celda = c => { const t = String(c ?? ''); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = '﻿' + [s.encabezados, ...s.filas].map(r => r.map(celda).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `informe-${s.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }));
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
        <h2 style="margin-top:0">Invitación: imagen y texto</h2>
        <p class="muted" style="margin-top:-6px">Se envían juntos con el enlace del formulario desde el botón "Compartir imagen y enlace" del Resumen. La imagen también es la vista previa al pegar el enlace en WhatsApp. Cada Bingo tiene los suyos.</p>
        <label class="full">Texto de la invitación
          <textarea name="textoInvitacion" rows="6" maxlength="1500" placeholder="Te invitamos a ${esc(e.nombre || 'nuestro bingo')} de las Hermanas Auxiliadoras de Cristo Sacerdote. Compra tus tablas aquí:">${esc(e.textoInvitacion)}</textarea>
          <span class="muted" style="font-weight:400">Escribe el mensaje que acompañará a la imagen (premios, precio, fecha, cuenta…). El enlace se agrega solo al final. Déjalo vacío para usar el texto predeterminado.</span>
        </label>
        <h3 style="margin:16px 0 4px">Imagen</h3>
        <div id="pieza-vista" style="margin:10px 0"></div>
        <input type="file" id="pieza-archivo" accept="image/png,image/jpeg,image/webp">
        <div class="actions"><button type="button" class="ghost danger" id="pieza-quitar">Quitar imagen</button></div>
      </div>

      <div class="card">
        <label class="full" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" name="envioAutomatico" style="width:auto" ${e.envioAutomatico ? 'checked' : ''}>
          Enviar las tablas automáticamente al verificar el pago (por WhatsApp y, si dejó correo, también por correo)
        </label>
        <span class="muted" style="font-weight:400">Solo se envía solo cuando el pago verificado cubre todas las tablas que pidió y no quedan pagos por verificar; en cualquier otro caso la compra queda en "Listas para enviar" para que decidas tú. Necesita WhatsApp Cloud API y Resend configurados; si no, el envío queda como "manual".</span>
        <label class="full" style="flex-direction:row;align-items:center;gap:8px;margin-top:12px">
          <input type="checkbox" name="exigirPagoCompleto" style="width:auto" ${e.exigirPagoCompleto ? 'checked' : ''}>
          Exigir que el pago verificado cubra las tablas que se envían (recomendado: nunca se entregan tablas sin pagar)
        </label>
      </div>
      <div class="actions"><button type="submit" class="grande">Guardar configuración</button></div>
    </form>`;

  // Imagen de invitación: se reduce a 1280 px y se guarda como JPG para que pese poco (la vista previa de WhatsApp pide menos de 300 KB).
  let pieza = null; // null = sin cambios; '' = quitar; data URL = nueva imagen
  const pintarPieza = () => {
    const estado = pieza === null ? e.pieza : (pieza === '' ? 'ninguna' : 'propia');
    $('pieza-vista').innerHTML = estado === 'ninguna'
      ? '<p class="muted">Este Bingo no tiene imagen de invitación.</p>'
      : `<img src="${pieza ? esc(pieza) : '/api/publico/invitacion.jpg?v=' + Date.now()}" alt="Imagen de invitación"
          style="max-width:240px;width:100%;border-radius:12px;border:1px solid var(--line)">
         <p class="muted" style="margin:6px 0 0">${estado === 'predeterminada' ? 'Es la imagen del bingo actual. Sube otra para reemplazarla.' : pieza ? 'Imagen nueva: pulsa "Guardar configuración".' : 'Imagen propia de este Bingo.'}</p>`;
    $('pieza-quitar').hidden = estado === 'ninguna';
  };
  pintarPieza();
  $('pieza-archivo').addEventListener('change', ev => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) { ev.target.value = ''; return msg('La imagen debe ser PNG, JPG o WEBP.', true); }
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1280 / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      let calidad = 0.85;
      let url = lienzo.toDataURL('image/jpeg', calidad);
      while (url.length > 1400000 && calidad > 0.4) { calidad -= 0.1; url = lienzo.toDataURL('image/jpeg', calidad); }
      pieza = url;
      pintarPieza();
      msg('Imagen lista. Pulsa "Guardar configuración".');
    };
    img.onerror = () => { ev.target.value = ''; msg('No se pudo leer la imagen.', true); };
    img.src = URL.createObjectURL(archivo);
  });
  $('pieza-quitar').addEventListener('click', () => { pieza = ''; $('pieza-archivo').value = ''; pintarPieza(); });

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
        textoInvitacion: f.textoInvitacion.value,
        exigirPagoCompleto: f.exigirPagoCompleto.checked,
        envioAutomatico: f.envioAutomatico.checked,
        ...(qrCambiado ? { qrPago: qr } : {}),
        ...(pieza !== null ? { piezaInvitacion: pieza } : {}),
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

// ---------- Transacciones: una fila por compra, con el detalle completo en el ojito ----------
let filtroTx = '';
let busquedaTx = '';
const ICONO_OJO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

// Consignación y transferencia se ven como "Transf."; el efectivo, como "Efect.".
const formaPago = metodos => [...new Set(String(metodos || '').split(', ').filter(Boolean)
  .map(m => (/efectivo/i.test(m) ? 'Efect.' : 'Transf.')))].join(' + ') || '—';
const esDonacion = c => c.cantidad === 0 || c.estado === 'donacion';

async function renderTransacciones() {
  const compras = await api('GET', '/admin/compras' + (filtroTx ? `?estado=${filtroTx}` : ''));
  const validas = compras.filter(c => c.estado !== 'rechazada');
  const totalValor = validas.reduce((s, c) => s + c.reportado, 0);
  const totalTablas = validas.reduce((s, c) => s + (esDonacion(c) ? 0 : (c.tablasAprobadas ?? c.cantidad)), 0);
  const fila = c => `
    <tr class="tx-fila" data-tx="${c.id}" data-texto="${esc([c.nombre, c.telefono, c.codigo].join(' ').toLowerCase())}">
      <td class="tx-nombre"><strong>${esc(c.nombre)}</strong><br><span class="muted mono">${esc(c.codigo)}</span></td>
      <td>${esc(c.telefono)}</td>
      <td class="num" title="Verificado: ${esc(dinero(c.pagado))}">${esc(dinero(c.reportado))}</td>
      <td>${esc(formaPago(c.metodos))}</td>
      <td class="num">${esDonacion(c) ? '<span class="tx-chulo" title="Donación, sin tablas">✔ <span class="muted">donación</span></span>' : (c.tablasAprobadas ?? c.cantidad)}</td>
      <td>${esc(c.fechaPago || '')}</td>
      <td><span class="pill ${esc(c.estado)}">${esc(c.estado === 'donacion' ? 'donación' : c.estado.replace('_', ' '))}</span></td>
      <td><button type="button" class="ghost tx-ojo" data-tx-ver="${c.id}" aria-expanded="false"
        aria-label="Ver el detalle de ${esc(c.nombre)}" title="Ver el detalle">${ICONO_OJO}</button></td>
    </tr>
    <tr class="tx-detalle" data-tx-detalle="${c.id}" hidden><td colspan="8">Cargando…</td></tr>`;
  $('vista').innerHTML = `
    <div class="tabs">${ESTADOS_COMPRA.map(([k, t]) =>
      `<button type="button" class="${filtroTx === k ? '' : 'ghost'}" data-ftx="${k}">${t}</button>`).join('')}</div>
    <input type="search" id="tx-buscar" placeholder="Buscar por nombre, celular o código" value="${esc(busquedaTx)}" style="margin-bottom:12px" aria-label="Buscar transacciones">
    <div class="tx-wrap"><table class="tx">
      <thead><tr><th>Benefactor</th><th>Celular</th><th class="num">Valor</th><th>Forma de pago</th><th class="num">Tablas</th><th>Fecha pago</th><th>Estado</th><th><span class="sr">Detalle</span></th></tr></thead>
      <tbody>${compras.map(fila).join('') || '<tr><td colspan="8" class="muted">No hay transacciones en esta lista.</td></tr>'}</tbody>
    </table></div>
    <p class="muted">${validas.length} transacción(es) · Valor reportado ${esc(dinero(totalValor))} · ${totalTablas} tabla(s). Las rechazadas no se suman.</p>`;

  const filtrar = () => {
    const q = $('tx-buscar').value.trim().toLowerCase();
    busquedaTx = $('tx-buscar').value;
    $('vista').querySelectorAll('tr.tx-fila').forEach(tr => {
      const oculta = q && !tr.dataset.texto.includes(q);
      tr.hidden = Boolean(oculta);
      if (oculta) $('vista').querySelector(`[data-tx-detalle="${tr.dataset.tx}"]`).hidden = true;
    });
  };
  $('tx-buscar').addEventListener('input', filtrar);
  filtrar();
  $('vista').querySelectorAll('[data-ftx]').forEach(b => b.addEventListener('click', () => { filtroTx = b.dataset.ftx; mostrar('transacciones'); }));
  $('vista').querySelectorAll('[data-tx-ver]').forEach(b => b.addEventListener('click', () => alternarDetalleTx(b)));
}

async function alternarDetalleTx(btn) {
  const id = btn.dataset.txVer;
  const det = $('vista').querySelector(`[data-tx-detalle="${id}"]`);
  const abrir = det.hidden;
  det.hidden = !abrir;
  btn.setAttribute('aria-expanded', String(abrir));
  if (!abrir || det.dataset.cargado) return;
  try {
    det.firstElementChild.innerHTML = detalleTx(await api('GET', `/admin/compras/${id}`));
    det.dataset.cargado = '1';
  } catch (err) {
    det.firstElementChild.textContent = err.message;
  }
}

function detalleTx(d) {
  const kv = (k, v) => (v === '' || v == null ? '' : `<div class="kv"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`);
  const donacion = esDonacion(d);
  const entrega = d.estado === 'enviada'
    ? kv('WhatsApp', d.whatsappEstado) + kv('Correo', d.correoEstado) + kv('Entrega física', d.fisicaEstado === 'no' ? '' : d.fisicaEstado)
    : '';
  const docs = d.pagos.flatMap(p => p.comprobantes.map(c => {
    const url = `/api/admin/comprobantes/${c.id}/archivo`;
    return /^image\//.test(c.tipo)
      ? `<a href="${url}" target="_blank" rel="noopener" title="${esc(c.nombre)}"><img loading="lazy" src="${url}" alt="Comprobante ${esc(c.nombre)}"></a>`
      : `<a class="btn ghost" href="${url}" target="_blank" rel="noopener">Abrir ${esc(c.nombre)}</a>`;
  }));
  return `
    <div class="tx-grid">
      <div>
        <h3>Benefactor</h3>
        ${kv('Código', d.codigo)}${kv('Nombre', d.nombre)}${kv('Cédula', d.cedula)}${kv('Celular', d.telefono)}
        ${kv('Correo', d.correo)}${kv('Ciudad', d.ciudad)}${kv('Se enteró por', d.referidoPor)}
        ${kv('Registrada', fecha(d.creadaEn))}${kv('Verificada', fecha(d.verificadaEn))}${kv('Enviada', fecha(d.enviadaEn))}
      </div>
      <div>
        <h3>${donacion ? 'Donación' : 'Compra'}</h3>
        ${donacion
          ? kv('Tipo', 'Donación sin tablas') + kv('Con su pago le corresponderían', `${d.estado === 'donacion' ? d.tablasSugeridas : d.tablasReportadas} tabla(s)`)
          : kv('Tablas pedidas', d.cantidad) + kv('Tablas enviadas', d.tablasAprobadas) + kv('Precio por tabla', dinero(d.precioUnitario)) + kv('Total', dinero(d.total))}
        ${kv('Pagado (verificado)', dinero(d.pagado))}${donacion ? '' : kv('Saldo', dinero(d.saldo))}
        ${kv('Sobrante', d.sobranteMonto > 0 ? `${dinero(d.sobranteMonto)} (${String(d.sobranteEstado).replace('_', ' ')})` : '')}
        ${entrega}
      </div>
    </div>
    <h3>Pagos</h3>
    ${d.pagos.map(p => `<div class="kv"><span>${esc(p.fechaPago)} · ${esc(p.metodo)}${p.referencia ? ' · ' + esc(p.referencia) : ''}</span>
      <span>${esc(dinero(p.montoReportado))}${p.montoVerificado != null ? ` (verificado ${esc(dinero(p.montoVerificado))})` : ''}
      <span class="pill ${esc(p.estado)}">${esc(p.estado.replace('_', ' '))}</span></span></div>`).join('') || '<p class="muted">Sin pagos.</p>'}
    <h3>Documentos adjuntos</h3>
    ${docs.length ? `<div class="tx-docs">${docs.join('')}</div>` : '<p class="muted">Sin documentos (pago en efectivo o sin comprobante).</p>'}
    <h3>Números de tablas</h3>
    ${d.tablas.length ? `<div class="tx-chips">${d.tablas.map(t => `<span class="mono">${esc(t)}</span>`).join('')}</div>`
      : `<p class="muted">${donacion ? 'Donación: no se asignaron tablas.' : 'Todavía no se han asignado tablas.'}</p>`}
    <div class="actions"><button type="button" class="ghost" data-tx-gestionar="${esc(d.estado)}">Gestionar en Compras</button></div>`;
}

// "Gestionar en Compras" lleva a la lista del mismo estado, donde están verificar, enviar, rechazar y los demás botones.
$('vista').addEventListener('click', e => {
  const b = e.target.closest('[data-tx-gestionar]');
  if (!b) return;
  filtroCompras = b.dataset.txGestionar;
  mostrar('compras');
});

// ---------- Bingos: histórico y reinicio ----------
const REPORTES_BINGO = [['compras', 'Compras'], ['pagos', 'Pagos'], ['deudas', 'Deudas'], ['sobrantes', 'Sobrantes'], ['tablas', 'Tablas vendidas'], ['premios', 'Premios'], ['gastos', 'Gastos']];

async function renderBingos() {
  const { actual, historico } = await api('GET', '/admin/bingos');
  const din = (n, m) => `${m ? m + ' ' : ''}${Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })}`;
  const tarjeta = b => {
    const m = b.config?.moneda;
    const r = b.resumen;
    return `<article class="card">
      <div class="row"><strong>${esc(b.nombre)}</strong><span class="pill enviada">cerrado</span></div>
      <p class="muted">${esc(fecha(b.iniciadoEn))} → ${esc(fecha(b.cerradoEn))}${b.config?.fechaSorteo ? ` · Sorteo: ${esc(b.config.fechaSorteo)}` : ''}${b.config?.precioTabla ? ` · Tabla a ${esc(din(b.config.precioTabla, m))}` : ''}</p>
      ${r ? `<div class="kv"><span>Tablas vendidas</span><strong>${r.tablasVendidas}</strong></div>
        <div class="kv"><span>Compras</span><strong>${r.compras}</strong></div>
        <div class="kv"><span>Cobrado</span><strong>${esc(din(r.dinero.cobrado, m))}</strong></div>
        <div class="kv"><span>Donaciones</span><strong>${esc(din(r.dinero.donaciones, m))}</strong></div>
        <div class="kv"><span>Premios pagados</span><strong>${esc(din(r.dinero.premiosPagados, m))}</strong></div>
        <div class="kv"><span>Gastos</span><strong>${esc(din(r.dinero.gastos, m))}</strong></div>
        <div class="kv"><span>Balance en caja</span><strong>${esc(din(r.dinero.balance, m))}</strong></div>` : ''}
      <details style="margin-top:10px"><summary class="muted">Descargar reportes de este Bingo (CSV)</summary>
        <div class="actions">${REPORTES_BINGO.map(([k, t]) =>
          `<a class="btn ghost" href="/api/admin/reportes/${k}.csv?bingo=${b.id}">${esc(t)}</a>`).join('')}</div>
      </details>
    </article>`;
  };
  $('vista').innerHTML = `
    <div class="card">
      <div class="row"><strong>${esc(actual.nombre)}</strong><span class="pill verificada">activo</span></div>
      <p class="muted">Desde ${esc(fecha(actual.iniciadoEn))}. Cada Bingo tiene su propia invitación y datos de pago (pestaña Configuración).</p>
    </div>
    <h2>Reiniciar Bingo</h2>
    <form id="form-reiniciar" class="card">
      <p>Cierra "${esc(actual.nombre)}" y empieza un Bingo nuevo desde cero. Lo vendido, los pagos, premios y gastos quedan guardados en el histórico,
        las tablas vuelven a estar disponibles y la invitación y los datos de pago del nuevo Bingo empiezan vacíos
        (no se podrán vender tablas hasta que configures el precio). Los enlaces que ya enviaste siguen funcionando.</p>
      <p class="muted">Antes de reiniciar, todas las compras deben estar enviadas, rechazadas o donadas. Descarga tus reportes si quieres una copia extra.</p>
      <div class="grid">
        <label>Nombre del nuevo Bingo <input name="nombre" required maxlength="120" placeholder="Ej. Bingo Navidad 2026"></label>
      </div>
      <label class="check"><input type="checkbox" name="confirmar" required> Entiendo que se cerrará el Bingo actual y empezará uno nuevo</label>
      <div class="actions"><button type="submit" class="danger">Reiniciar Bingo</button></div>
    </form>
    <h2>Histórico (${historico.length})</h2>
    ${historico.map(tarjeta).join('') || '<p class="muted">Todavía no hay Bingos cerrados.</p>'}`;

  $('form-reiniciar').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (!confirm(`¿Cerrar "${actual.nombre}" y empezar "${f.nombre.value.trim()}" desde cero?`)) return;
    accion(async () => {
      const r = await api('POST', '/admin/bingos/reiniciar', { nombre: f.nombre.value, confirmar: f.confirmar.checked });
      const res = await api('GET', '/admin/resumen');
      moneda = res.evento.moneda;
      $('titulo').textContent = res.evento.nombre || 'Bingo';
      vistaActual = 'config';
      await mostrar('config');
      msg(`"${r.cerrado.nombre}" quedó en el histórico. Configura la invitación y los datos de pago de "${r.nuevo.nombre}" (precio, cuenta, fecha) para abrir las ventas.`);
    });
  });
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
