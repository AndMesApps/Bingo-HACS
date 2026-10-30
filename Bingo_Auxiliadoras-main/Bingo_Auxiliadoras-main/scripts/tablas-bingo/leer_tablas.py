"""Lee los 25 números de cada tabla JPG comparando cada celda con el número dibujado con la misma fuente."""
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CARPETA = r'C:\bingo_hacs\TABLAS BINGO JPG'
FUENTE = r'C:\Windows\Fonts\segoeuib.ttf'
CX = [156, 328, 500, 672, 844]
CY = [645, 800, 953, 1107, 1262]
RANGOS = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75)]
MEDIA_W, MEDIA_H = 80, 56  # mitad de la ventana de comparación


def plantilla(numero, tam):
    """Máscara (0-255) del número centrado en la ventana, dibujado como en las tablas."""
    f = ImageFont.truetype(FUENTE, tam)
    lienzo = Image.new('L', (2 * MEDIA_W, 2 * MEDIA_H), 0)
    d = ImageDraw.Draw(lienzo)
    caja = d.textbbox((0, 0), str(numero), font=f)
    w, h = caja[2] - caja[0], caja[3] - caja[1]
    x = MEDIA_W - w / 2 - caja[0]
    y = MEDIA_H - h / 2 - caja[1]
    d.text((x, y), str(numero), font=f, fill=255)
    return np.asarray(lienzo).astype(np.float32)


def recorte(a, c, r):
    x, y = CX[c], CY[r]
    sub = a[y - MEDIA_H:y + MEDIA_H, x - MEDIA_W:x + MEDIA_W]
    # oscuridad = qué tan lejos del blanco (el texto es azul oscuro, la celda blanca)
    return (255 - sub.mean(axis=2)).astype(np.float32) * (255.0 / (255 - 45))


def mejor(rec, c, plant):
    lo, hi = RANGOS[c]
    resultados = []
    for n in range(lo, hi + 1):
        p = plant[n]
        # alinear con un pequeño desplazamiento por si el centro difiere 1-2 px
        mejor_err = 1e18
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                pr = np.roll(np.roll(p, dy, axis=0), dx, axis=1)
                err = float(np.abs(np.clip(rec, 0, 255) - pr).mean())
                mejor_err = min(mejor_err, err)
        resultados.append((mejor_err, n))
    resultados.sort()
    return resultados


def calibrar():
    esperado = [[6, 24, 44, 60, 73], [13, 21, 33, 48, 71], [10, 30, None, 59, 69], [2, 29, 35, 57, 62], [1, 22, 36, 54, 65]]
    a = np.asarray(Image.open(CARPETA + r'\1.jpg').convert('RGB')).astype(np.float32)
    for tam in range(62, 74):
        plant = {n: plantilla(n, tam) for n in range(1, 76)}
        total = 0.0
        bien = 0
        for r in range(5):
            for c in range(5):
                if esperado[r][c] is None:
                    continue
                res = mejor(recorte(a, c, r), c, plant)
                total += res[0][0]
                bien += res[0][1] == esperado[r][c]
        print('tamaño', tam, 'error medio', round(total / 24, 3), 'aciertos', bien, '/24')


def leer_todas(tam):
    plant = {n: plantilla(n, tam) for n in range(1, 76)}
    salida = {}
    dudosas = []
    global DETALLE
    DETALLE = {}
    for k in range(1, 401):
        a = np.asarray(Image.open(f'{CARPETA}\\{k}.jpg').convert('RGB')).astype(np.float32)
        tabla = []
        for r in range(5):
            fila = []
            for c in range(5):
                if r == 2 and c == 2:
                    fila.append(0)
                    continue
                res = mejor(recorte(a, c, r), c, plant)
                err, n = res[0]
                margen = res[1][0] - err
                DETALLE[(k, r, c)] = (n, err, margen, res[1][1])
                if err > 6 or margen < 3:
                    dudosas.append((k, r, c, n, round(err, 2), round(margen, 2)))
                fila.append(n)
            tabla.append(fila)
        salida[k] = tabla
    return salida, dudosas


if __name__ == '__main__':
    if sys.argv[1] == 'calibrar':
        calibrar()
    else:
        tam = int(sys.argv[2])
        salida, dudosas = leer_todas(tam)
        json.dump(salida, open(sys.argv[3], 'w'))
        json.dump({f'{k[0]},{k[1]},{k[2]}': v for k, v in DETALLE.items()}, open(sys.argv[3] + '.detalle', 'w'))
        print('tablas leídas', len(salida), 'celdas dudosas', len(dudosas))
        for d in dudosas[:40]:
            print('dudosa', d)
