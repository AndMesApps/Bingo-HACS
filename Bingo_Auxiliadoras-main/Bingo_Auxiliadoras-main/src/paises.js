// Países para el selector del formulario y para dar formato legible a los teléfonos.
// codigo = indicativo telefónico internacional, sin "+".
const PAISES = [
  { nombre: 'Colombia', codigo: '57' },
  { nombre: 'Venezuela', codigo: '58' },
  { nombre: 'Ecuador', codigo: '593' },
  { nombre: 'Perú', codigo: '51' },
  { nombre: 'Panamá', codigo: '507' },
  { nombre: 'México', codigo: '52' },
  { nombre: 'Estados Unidos, Canadá y Caribe (+1)', codigo: '1' },
  { nombre: 'España', codigo: '34' },
  { nombre: 'Argentina', codigo: '54' },
  { nombre: 'Bolivia', codigo: '591' },
  { nombre: 'Brasil', codigo: '55' },
  { nombre: 'Chile', codigo: '56' },
  { nombre: 'Costa Rica', codigo: '506' },
  { nombre: 'Cuba', codigo: '53' },
  { nombre: 'El Salvador', codigo: '503' },
  { nombre: 'Guatemala', codigo: '502' },
  { nombre: 'Honduras', codigo: '504' },
  { nombre: 'Nicaragua', codigo: '505' },
  { nombre: 'Paraguay', codigo: '595' },
  { nombre: 'Uruguay', codigo: '598' },
  { nombre: 'Alemania', codigo: '49' },
  { nombre: 'Australia', codigo: '61' },
  { nombre: 'Francia', codigo: '33' },
  { nombre: 'Italia', codigo: '39' },
  { nombre: 'Países Bajos', codigo: '31' },
  { nombre: 'Portugal', codigo: '351' },
  { nombre: 'Reino Unido', codigo: '44' },
  { nombre: 'Suiza', codigo: '41' },
];

const CODIGOS = [...new Set(PAISES.map(p => p.codigo))];

// Devuelve el indicativo conocido con el que empieza el número (el más largo), o ''.
function indicativoDe(digitos) {
  const d = String(digitos ?? '');
  return CODIGOS.filter(c => d.startsWith(c)).sort((a, b) => b.length - a.length)[0] || '';
}

module.exports = { PAISES, indicativoDe };
