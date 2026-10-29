const test = require('node:test');
const assert = require('node:assert/strict');
const { rutaDe } = require('../src/http');

test('la ruta se toma de la URL real, con o sin parámetros', () => {
  assert.equal(rutaDe({ url: '/api/publico/evento' }), '/evento');
  assert.equal(rutaDe({ url: '/api/publico/compras/BNG-4K7P2X?x=1' }), '/compras/BNG-4K7P2X');
  assert.equal(rutaDe({ url: '/api/admin/compras/12/enviar' }), '/compras/12/enviar');
  assert.equal(rutaDe({ url: '/api/admin/reportes/compras.csv' }), '/reportes/compras.csv');
  assert.equal(rutaDe({ url: '/api/publico/entrega/' + 'a'.repeat(32) + '/imagen/37?_=1' }), '/entrega/' + 'a'.repeat(32) + '/imagen/37');
  assert.equal(rutaDe({ url: '/api/publico' }), '/');
});

test('sin URL usa el parámetro catch-all, ya sea lista o texto con barras', () => {
  assert.equal(rutaDe({ query: { ruta: ['compras', 'BNG-1'] } }), '/compras/BNG-1');
  assert.equal(rutaDe({ query: { ruta: 'compras/BNG-1' } }), '/compras/BNG-1');
  assert.equal(rutaDe({ query: { ruta: 'evento' } }), '/evento');
  assert.equal(rutaDe({ query: {} }), '/');
});
