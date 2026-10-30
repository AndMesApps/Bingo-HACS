"""Verifica las imágenes nuevas leyéndolas de nuevo (no se fía de los datos del generador) y audita todas las tablas.

Uso:   python verificar_nuevas.py PRIMERA ULTIMA
Ej.:   python verificar_nuevas.py 401 500
"""
import collections
import json
import os
import sys
import numpy as np
from PIL import Image
import leer_tablas as L
from generar_tablas import numeros, columnas, lineas, cargar_existentes, SALIDA, AQUI

primera, ultima = int(sys.argv[1]), int(sys.argv[2])
rango = range(primera, ultima + 1)
plant = {n: L.plantilla(n, 66) for n in range(1, 76)}
previstas = {int(k): v for k, v in json.load(open(os.path.join(AQUI, f'numeros-{primera}-{ultima}.json'))).items()}
todas_previas = cargar_existentes()
viejas = {k: g for k, g in todas_previas.items() if k not in rango}

leidas, dudosas = {}, []
for k in rango:
    a = np.asarray(Image.open(f'{SALIDA}\\{k}.jpg').convert('RGB')).astype(np.float32)
    g = []
    for r in range(5):
        fila = []
        for c in range(5):
            if r == 2 and c == 2:
                fila.append(0)
                continue
            res = L.mejor(L.recorte(a, c, r), c, plant)
            err, n = res[0]
            if err > 6 or res[1][0] - err < 2.5:
                dudosas.append((k, r, c, n, round(err, 2), round(res[1][0] - err, 2)))
            fila.append(n)
        g.append(fila)
    leidas[k] = g

print('1) lectura de las imágenes = datos del generador:', leidas == previstas, '| celdas dudosas:', len(dudosas))
todas = {**viejas, **leidas}
malas = []
for k, g in todas.items():
    nums = [g[r][c] for r in range(5) for c in range(5) if not (r == 2 and c == 2)]
    if len(set(nums)) != 24:
        malas.append((k, 'repetidos'))
    for c, (lo, hi) in enumerate(L.RANGOS):
        col = [g[r][c] for r in range(5) if not (r == 2 and c == 2)]
        if any(not (lo <= x <= hi) for x in col):
            malas.append((k, 'rango', c))
print('2) problemas de rango o repetidos dentro de una tabla:', malas)
print('3) tablas con la misma disposición que otra:', sum(1 for v in collections.Counter(json.dumps(g) for g in todas.values()).values() if v > 1))
print('4) tablas con los mismos números por columna que otra:', sum(1 for v in collections.Counter(tuple(columnas(g)) for g in todas.values()).values() if v > 1))
col_rep = lin_rep = max_comun = 0
for k in rango:
    for otra, g2 in todas.items():
        if otra == k:
            continue
        col_rep += sum(columnas(leidas[k])[c] == columnas(g2)[c] for c in range(5))
        lin_rep += len(set(lineas(leidas[k])) & set(lineas(g2)))
        max_comun = max(max_comun, len(numeros(leidas[k]) & numeros(g2)))
print('5) columnas de una tabla nueva iguales a las de otra:', col_rep)
print('6) filas/diagonales de una tabla nueva iguales a las de otra:', lin_rep)
print('7) máximo de números en común entre una tabla nueva y cualquier otra:', max_comun, 'de 24')
print('8) imágenes verificadas:', len(leidas))
