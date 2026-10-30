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

// numeros: 25 enteros por filas (0 = casilla libre). cantadas: conjunto de balotas (1-75).
// Devuelve { cumple, marcadas: boolean[25], faltan: número de balotas que le faltan a la combinación más cercana }.
function evaluarTabla(figura, numeros, cantadas) {
  const def = FIGURAS[figura];
  if (!def) throw new Error(`Figura desconocida: ${figura}`);
  const cantadasSet = cantadas instanceof Set ? cantadas : new Set(cantadas);
  const marcadas = numeros.map(n => n === 0 || cantadasSet.has(n));
  let faltan = Infinity;
  for (const comb of def.combinaciones) {
    faltan = Math.min(faltan, comb.filter(i => !marcadas[i]).length);
  }
  return { cumple: faltan === 0, marcadas, faltan };
}

const LETRAS = ['B', 'I', 'N', 'G', 'O'];
const letraDe = n => LETRAS[Math.min(4, Math.floor((n - 1) / 15))];

module.exports = { FIGURAS, FIGURA_POR_DEFECTO, evaluarTabla, letraDe, LETRAS };
