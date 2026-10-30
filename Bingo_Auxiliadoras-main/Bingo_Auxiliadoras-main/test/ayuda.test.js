const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buscar, palabrasDe, norm } = require('../public/ayuda.js');

// Lee el manual real y lo parte en temas (un título h2 con su id y lo que sigue), igual que hace el navegador.
function seccionesDelManual() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'manual.html'), 'utf8');
  const cuerpo = html.slice(html.indexOf('<main>'));
  const partes = cuerpo.split(/<h2 id="/).slice(1);
  return partes.map(p => {
    const id = p.slice(0, p.indexOf('"'));
    const claves = (/data-claves="([^"]*)"/.exec(p) || [])[1] || '';
    const titulo = p.slice(p.indexOf('>') + 1, p.indexOf('</h2>')).replace(/^\s*\d+\.\s*/, '').trim();
    const resto = p.slice(p.indexOf('</h2>') + 5).split('<div class="parte"')[0];
    const texto = resto.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
    return { id, titulo, claves, texto, parte: /^a\d/.test(id) ? 'Para el benefactor' : 'Para la administración' };
  }).filter(s => s.id !== 'indice');
}

const ids = (secs, q, n = 3) => buscar(secs, q, 6).slice(0, n).map(r => r.id);

test('ayuda: el manual se parte en sus 36 temas, todos con palabras clave', () => {
  const secs = seccionesDelManual();
  assert.equal(secs.length, 36);
  for (const s of secs) assert.ok(s.claves.length > 5, `el tema ${s.id} no tiene palabras clave`);
});

test('ayuda: «dónde cambio el texto del mensaje y el link de conexión» lleva al tema correcto', () => {
  const secs = seccionesDelManual();
  const top = ids(secs, 'dónde puedo cambiar el texto que le llega al benefactor con las tablas y el link de conexión');
  assert.equal(top[0], 'b26', 'primero, el tema que explica qué se cambia y qué es fijo');
  assert.ok(top.includes('b3') || top.includes('b7'), 'y cerca, Configuración o el envío del mensaje');
  assert.deepEqual(palabrasDe('el LINK de la reunión'), ['link', 'enlace', 'reunion', 'conexion']);
});

test('ayuda: preguntas frecuentes encuentran su tema', () => {
  const secs = seccionesDelManual();
  const casos = [
    ['cómo envío las tablas por whatsapp', ['b6', 'b7']],
    ['quiero cantar los números del bingo', ['b15']],
    ['no me acuerdo de la contraseña', ['b1']],
    ['cómo imprimo mis tablas', ['a8']],
    ['dos personas gritaron bingo', ['b16']],
    ['cómo anoto un gasto', ['b18']],
    ['quiero empezar otro bingo desde cero', ['b23']],
    ['pagué de más y me sobró plata', ['a4', 'b10']],
    ['subir la foto del recibo', ['a3']],
    ['sacar el informe en excel', ['b20', 'b21']],
    ['entregar el premio a la ganadora', ['b17']],
    ['verificar el pago de una compra', ['b5']],
  ];
  for (const [q, esperados] of casos) {
    const top = ids(secs, q, 3);
    assert.ok(esperados.some(e => top.includes(e)), `«${q}» debería traer ${esperados.join(' o ')} y trajo ${top.join(', ')}`);
  }
});

test('ayuda: lo que no existe no devuelve temas sueltos', () => {
  const secs = seccionesDelManual();
  assert.deepEqual(buscar(secs, 'xyzzy plugh', 6), []);
  assert.deepEqual(buscar(secs, '   ', 6), []);
  assert.equal(norm('Contraseña ÁÉÍÓÚ'), 'contrasena aeiou');
});
