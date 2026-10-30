"""Genera tablas nuevas con números nunca repetidos respecto de TODAS las tablas existentes ni entre sí.

Uso:   python generar_tablas.py PRIMERA CANTIDAD [imagenes]
Ej.:   python generar_tablas.py 501 100 imagenes

Lee los números de las tablas existentes de los archivos numeros-*.json de esta carpeta y guarda los nuevos en
numeros-PRIMERA-ULTIMA.json (conservarlo en el repositorio: es la fuente para que la próxima vez no se repita nada).

Reglas (más estrictas que 'la tabla completa es distinta'):
  1. Rangos de bingo: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75; sin repetidos dentro de la tabla; centro libre.
  2. La tabla completa es distinta de cualquier otra (existente o nueva).
  3. Ninguna COLUMNA tiene el mismo conjunto de números que la misma columna de otra tabla.
  4. Ninguna LÍNEA (fila o diagonal) repite las líneas de otra tabla.
  5. Dos tablas comparten como máximo MAX_COMUN números (las 400 primeras comparten hasta 16 de 24).
"""
import glob
import json
import os
import random
import sys
from PIL import Image
from dibujo_tabla import dibujar, CARPETA

AQUI = os.path.dirname(os.path.abspath(__file__))
RANGOS = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75)]
MAX_COMUN = 14
SALIDA = r'C:\bingo_hacs\TABLAS BINGO JPG NUEVAS'
rng = random.SystemRandom()


def numeros(g):
    return {g[r][c] for r in range(5) for c in range(5) if not (r == 2 and c == 2)}


def columnas(g):
    return [frozenset(g[r][c] for r in range(5) if not (r == 2 and c == 2)) for c in range(5)]


def lineas(g):
    """Filas y diagonales como conjuntos (el centro libre cuenta como 0)."""
    filas = [frozenset(g[r]) for r in range(5)]
    d1 = frozenset(g[i][i] for i in range(5))
    d2 = frozenset(g[i][4 - i] for i in range(5))
    return filas + [d1, d2]


def cargar_existentes():
    todas = {}
    for ruta in sorted(glob.glob(os.path.join(AQUI, 'numeros-*.json'))):
        for k, g in json.load(open(ruta)).items():
            assert int(k) not in todas, f'La tabla {k} aparece en dos archivos'
            todas[int(k)] = g
    return todas


def nueva():
    cols = []
    for c, (lo, hi) in enumerate(RANGOS):
        n = 4 if c == 2 else 5
        cols.append(rng.sample(range(lo, hi + 1), n))
    g = [[0] * 5 for _ in range(5)]
    for c in range(5):
        filas = [r for r in range(5) if not (c == 2 and r == 2)]
        for r, v in zip(filas, cols[c]):
            g[r][c] = v
    return g


def generar(existentes, primera, cantidad):
    todas = dict(existentes)
    ocupadas_cols = [set() for _ in range(5)]
    ocupadas_lineas = set()
    firmas = set()
    nums = {k: numeros(g) for k, g in todas.items()}
    for g in todas.values():
        for c, s in enumerate(columnas(g)):
            ocupadas_cols[c].add(s)
        ocupadas_lineas.update(lineas(g))
        firmas.add(json.dumps(g))
    nuevas = {}
    while len(nuevas) < cantidad:
        g = nueva()
        cs, ls, ns = columnas(g), lineas(g), numeros(g)
        if json.dumps(g) in firmas:
            continue
        if any(cs[c] in ocupadas_cols[c] for c in range(5)):
            continue
        if any(l in ocupadas_lineas for l in ls) or len(set(ls)) != len(ls):
            continue
        if any(len(ns & otro) > MAX_COMUN for otro in nums.values()):
            continue
        k = primera + len(nuevas)
        assert k not in todas, f'La tabla {k} ya existe'
        nuevas[k] = g
        nums[k] = ns
        firmas.add(json.dumps(g))
        for c in range(5):
            ocupadas_cols[c].add(cs[c])
        ocupadas_lineas.update(ls)
    return nuevas


if __name__ == '__main__':
    primera, cantidad = int(sys.argv[1]), int(sys.argv[2])
    nuevas = generar(cargar_existentes(), primera, cantidad)
    destino = os.path.join(AQUI, f'numeros-{primera}-{primera + cantidad - 1}.json')
    json.dump(nuevas, open(destino, 'w'))
    print('generadas', len(nuevas), '->', destino)
    if 'imagenes' in sys.argv:
        os.makedirs(SALIDA, exist_ok=True)
        plantilla = Image.open(CARPETA + r'\2.jpg').convert('RGB')
        for k, g in nuevas.items():
            dibujar(plantilla, g, k, tam_rotulo=40, rotulo_centro=(499.5, 387)).save(
                f'{SALIDA}\\{k}.jpg', quality=88, subsampling=0)
        print('imágenes en', SALIDA)
