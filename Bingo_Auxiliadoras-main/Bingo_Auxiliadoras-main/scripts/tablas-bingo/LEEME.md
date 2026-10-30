# Tablas de bingo: generar más sin repetir

Las tablas son imágenes (`N.jpg`, 1000 x 1420) con el diseño de las Hermanas Auxiliadoras de Cristo Sacerdote.
Estos scripts de Python (Pillow y numpy) las leen, generan nuevas y verifican que ninguna distribución se repita.

- `numeros-*.json`: los 24 números de cada tabla (el centro es la casilla libre, 0). **Es la fuente de verdad**:
  `numeros-1-400.json` se leyó de las imágenes originales y `numeros-401-500.json` se generó. Guárdalos siempre.
- `dibujo_tabla.py`: dibuja una tabla sobre la plantilla de una tabla existente (mismo marco, encabezado, celdas y
  logo; cambian los números y el rótulo "TABLA N° X"). Fuente Segoe UI Bold: 66 px los números, 40 px el rótulo.
- `leer_tablas.py`: lee los números de las imágenes comparando cada celda con el número dibujado con la misma fuente.
- `generar_tablas.py`: genera tablas nuevas con las reglas de unicidad (ver el encabezado del archivo).
- `verificar_nuevas.py`: vuelve a leer las imágenes generadas y audita todas las tablas juntas.

## Generar 100 tablas más (ejemplo: 501 a 600)

```
cd scripts\tablas-bingo
python generar_tablas.py 501 100 imagenes
python verificar_nuevas.py 501 600
```

Las imágenes quedan en `C:\bingo_hacs\TABLAS BINGO JPG NUEVAS`. Las rutas de la plantilla (`CARPETA` en
`dibujo_tabla.py`) y de salida (`SALIDA` en `generar_tablas.py`) están escritas para el PC del proyecto.

Después: subir las imágenes al bucket `tablas` de Supabase (Storage) **antes** de importar los seriales en el panel
(Tablas → Importar tablas existentes), para que ninguna tabla exista sin imagen. Guardar el nuevo `numeros-*.json`.

No uses el botón "Generar tablas nuevas" del panel: crea seriales sin imagen ni números.
