"""Dibuja una tabla de bingo sobre la plantilla de una tabla existente: mismo marco, encabezado, celdas y logo;
solo cambian los 24 números y el rótulo "TABLA N° X"."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CARPETA = r'C:\bingo_hacs\TABLAS BINGO JPG'
FUENTE_B = r'C:\Windows\Fonts\segoeuib.ttf'
CX = [156, 328, 500, 672, 844]
CY = [645, 800, 953, 1107, 1262]
TINTA = (15, 52, 72)
DORADO = (201, 162, 75)
TAM_NUM = 66
TAM_ROTULO = 40


def centrar(d, texto, centro, fuente, fill, espaciado=0):
    """Dibuja el texto con el centro de su caja en 'centro' (igual que en las tablas originales)."""
    cx, cy = centro
    caja = d.textbbox((0, 0), texto, font=fuente)
    w, h = caja[2] - caja[0], caja[3] - caja[1]
    d.text((cx - w / 2 - caja[0], cy - h / 2 - caja[1]), texto, font=fuente, fill=fill)


def dibujar(plantilla, grid, numero_tabla, tam_rotulo=TAM_ROTULO, rotulo_centro=(499.5, 386)):
    im = plantilla.copy()
    d = ImageDraw.Draw(im)
    f_num = ImageFont.truetype(FUENTE_B, TAM_NUM)
    for r in range(5):
        for c in range(5):
            if r == 2 and c == 2:
                continue  # casilla libre: el logo se conserva de la plantilla
            d.rectangle((CX[c] - 62, CY[r] - 40, CX[c] + 62, CY[r] + 40), fill=(255, 255, 255))
            centrar(d, str(grid[r][c]), (CX[c], CY[r]), f_num, TINTA)
    # rótulo: se repinta el interior de la píldora dorada y se escribe el número de tabla
    d.rectangle((358, 368, 642, 404), fill=DORADO)
    f_rot = ImageFont.truetype(FUENTE_B, tam_rotulo)
    centrar(d, f'TABLA  N° {numero_tabla}', rotulo_centro, f_rot, TINTA)
    return im
