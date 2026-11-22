// Figuras que se pueden ganar en una ronda. Una tabla es de 5x5 (columnas B-I-N-G-O); las casillas se numeran 0-24
// de izquierda a derecha y de arriba abajo. El centro (12) es casilla libre y siempre cuenta como marcada.
// Una figura se cumple cuando TODAS las casillas de al menos una de sus combinaciones están marcadas.

const fila = r => [0, 1, 2, 3, 4].map(c => r * 5 + c);
const columna = c => [0, 1, 2, 3, 4].map(r => r * 5 + c);
const diagonalA = [0, 6, 12, 18, 24];
const diagonalB = [4, 8, 12, 16, 20];

const FIGURAS = {
  linea: {
    nombre: 'Línea (fila, columna o diagonal)',
    combinaciones: [...[0, 1, 2, 3, 4].map(fila), ...[0, 1, 2, 3, 4].map(columna), diagonalA, diagonalB],
  },
  cuatro_esquinas: { nombre: 'Cuatro esquinas', combinaciones: [[0, 4, 20, 24]] },
  equis: { nombre: 'Equis (las dos diagonales)', combinaciones: [[...diagonalA, ...diagonalB]] },
  marco: { nombre: 'Marco (todo el borde)', combinaciones: [[...fila(0), ...fila(4), 5, 10, 15, 9, 14, 19]] },
  carton_lleno: { nombre: 'Cartón lleno', combinaciones: [Array.from({ length: 25 }, (_, i) => i)] },
};

const FIGURA_POR_DEFECTO = 'carton_lleno';

// Figura dibujada a mano: "personalizada:0,6,12,18,24" (casillas 0-24; el centro, 12, es libre y se ignora).
// Se cumple cuando TODAS las casillas dibujadas están marcadas.
const PREFIJO_PERSONALIZADA = 'personalizada:';

function casillasPersonalizada(figura) {
  if (typeof figura !== 'string' || !figura.startsWith(PREFIJO_PERSONALIZADA)) return null;
  const partes = figura.slice(PREFIJO_PERSONALIZADA.length).split(',').filter(x => x !== '');
  const casillas = partes.map(Number);
  if (!casillas.length || casillas.some((c, i) => !Number.isInteger(c) || c < 0 || c > 24 || casillas.indexOf(c) !== i)) return null;
  return casillas.sort((a, b) => a - b);
}

// Devuelve { nombre, combinaciones, casillas } o null si la figura no existe. "casillas" solo si hay una única forma
// (sirve para dibujarla); las figuras con varias combinaciones (línea) no la tienen.
function definirFigura(figura) {
  if (FIGURAS[figura]) {
    const f = FIGURAS[figura];
    return { nombre: f.nombre, combinaciones: f.combinaciones, casillas: f.combinaciones.length === 1 ? f.combinaciones[0] : null };
  }
  const c = casillasPersonalizada(figura);
  if (!c) return null;
  const reales = c.filter(i => i !== 12).length;
  return { nombre: `Figura dibujada (${reales} casilla${reales === 1 ? '' : 's'})`, combinaciones: [c], casillas: c };
}

function figuraPersonalizada(casillas) {
  const lista = [...new Set((casillas || []).map(Number))].filter(c => Number.isInteger(c) && c >= 0 && c <= 24 && c !== 12);
  return PREFIJO_PERSONALIZADA + lista.sort((a, b) => a - b).join(',');
}

// numeros: 25 enteros por filas (0 = casilla libre). cantadas: conjunto de balotas (1-75).
// Devuelve { cumple, marcadas: boolean[25], faltan: balotas que le faltan a la combinación más cercana,
// numerosFaltan: cuáles son esas balotas }.
function evaluarTabla(figura, numeros, cantadas) {
  const def = definirFigura(figura);
  if (!def) throw new Error(`Figura desconocida: ${figura}`);
  const cantadasSet = cantadas instanceof Set ? cantadas : new Set(cantadas);
  const marcadas = numeros.map(n => n === 0 || cantadasSet.has(n));
  let faltan = Infinity;
  let mejor = [];
  for (const comb of def.combinaciones) {
    const sin = comb.filter(i => !marcadas[i]);
    if (sin.length < faltan) { faltan = sin.length; mejor = sin; }
  }
  return { cumple: faltan === 0, marcadas, faltan, numerosFaltan: mejor.map(i => numeros[i]) };
}

const LETRAS = ['B', 'I', 'N', 'G', 'O'];
const letraDe = n => LETRAS[Math.min(4, Math.floor((n - 1) / 15))];

module.exports = { FIGURAS, FIGURA_POR_DEFECTO, definirFigura, figuraPersonalizada, evaluarTabla, letraDe, LETRAS };
