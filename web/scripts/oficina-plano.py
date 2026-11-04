"""Construye el plano ampliado de la oficina a partir del plano base (ChatGPT).

Corta y repite bandas del plano original (nada se genera en tiempo de ejecución):
  - descanso doble (se repite la franja de la mesa redonda),
  - 3 salas de reuniones (se repite la sala completa),
  - área de trabajo y pasillo más altos (se repite una franja de suelo/pared lisa),
  - puertas abiertas en los muros (el original solo tenía ventanas).
Uso suelto (desde web/): python3 -I scripts/oficina-plano.py <carpeta-originales> <archivo-del-plano> <salida.png>
Normalmente lo llama scripts/oficina-assets.py.
Si cambia el plano base, se ajustan solo las constantes de RECETA y PUERTAS.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw


# Franjas verticales: (x0, x1). Cada una repite sus propias filas del original.
X_IZQ, X_PAS, X_TRAB = (0, 546), (546, 662), (662, 1672)
# Filas del original [a, b). Orden = orden de apilado en el plano final.
FIL_IZQ = [(0, 301), (142, 301), (301, 559), (301, 559), (301, 559), (559, 941)]
FIL_CENT = [(0, 516)] + [(346, 516)] * 3 + [(346, 511)] + [(516, 941)]   # pasillo y área de trabajo (3 × 170 + 165 filas)
PARCHE_MURO, PARCHE_MURO_DONANTE = (506, 546), 335
RECORTE_INFERIOR = 915   # el original deja ~30 px de suelo exterior bajo el muro


def apilar(im: np.ndarray, filas):
    return np.concatenate([im[a:b] for a, b in filas], axis=0)


# Puertas: (x0, x1, y0, y1, desplazamiento_x_del_suelo_donante, desplazamiento_y_donante, eje). El hueco se rellena con suelo del
# lado contrario del muro (mismo y), se marcan las jambas y se dibuja la hoja abierta.
# Coordenadas del plano final. "v" = muro vertical (se cruza de este a oeste).
PUERTAS = [
    # sala de descanso (2 mitades), 3 salas de reuniones y oficina del gerente → pasillo
    (505, 545, 226, 290, 52, 0, "v"), (505, 545, 386, 450, 52, 0, "v"),
    (505, 545, 585, 649, 52, 0, "v"), (505, 545, 843, 907, 52, 0, "v"), (505, 545, 1101, 1165, 52, 0, "v"),
    (505, 545, 1366, 1430, 52, -170, "v"),   # la alfombra del pasillo queda al lado: se toma suelo liso de más arriba
    # pasillo → área de trabajo
    (659, 697, 402, 466, 52, 0, "v"), (659, 697, 900, 964, 52, 0, "v"), (659, 697, 1380, 1444, 52, 0, "v"),
    # baño → pasillo (la ventana inferior del baño pasa a ser puerta)
    (574, 632, 176, 200, 8, 0, "h"),
]
NEGRO, AZUL, AZUL_CLARO, MADERA, MADERA_OSC = (14, 18, 30), (30, 78, 140), (92, 160, 220), (176, 132, 82), (128, 90, 54)


def abrir_puerta(out: np.ndarray, x0, x1, y0, y1, desp, dy, eje):
    """Rellena el hueco con suelo, marca las jambas y dibuja la hoja de la puerta abierta."""
    if eje == "v":   # muro vertical: se cruza de este a oeste; la hoja sale hacia el pasillo
        out[y0:y1, x0:x1] = out[y0 + dy:y1 + dy, x1 + desp - (x1 - x0):x1 + desp]
        out[y0:y0 + 3, x0:x1] = NEGRO; out[y1 - 3:y1, x0:x1] = NEGRO
        out[y0 + 3:y0 + 6, x0 + 3:x1 - 3] = AZUL; out[y1 - 6:y1 - 3, x0 + 3:x1 - 3] = AZUL
        hx0, hy0, largo, grueso = x1 - 2, y0 + 6, 40, 7
        out[hy0 - 1:hy0 + grueso + 1, hx0 - 1:hx0 + largo + 1] = NEGRO
        out[hy0:hy0 + grueso, hx0:hx0 + largo] = AZUL
        out[hy0:hy0 + 2, hx0:hx0 + largo] = AZUL_CLARO
        out[hy0 + 2:hy0 + 4, hx0 + largo - 9:hx0 + largo - 3] = (230, 236, 244)   # tirador
    else:            # muro horizontal: se cruza de norte a sur; la hoja baja hacia el pasillo
        out[y0:y1, x0:x1] = out[y1 + desp:y1 + desp + (y1 - y0), x0:x1]
        out[y0:y1, x0:x0 + 3] = NEGRO; out[y0:y1, x1 - 3:x1] = NEGRO
        out[y0 + 3:y1 - 3, x0 + 3:x0 + 6] = AZUL; out[y0 + 3:y1 - 3, x1 - 6:x1 - 3] = AZUL
        hx0, hy0, largo, grueso = x0 + 6, y1 - 2, 40, 7
        out[hy0 - 1:hy0 + largo + 1, hx0 - 1:hx0 + grueso + 1] = NEGRO
        out[hy0:hy0 + largo, hx0:hx0 + grueso] = AZUL
        out[hy0:hy0 + largo, hx0:hx0 + 2] = AZUL_CLARO
        out[hy0 + largo - 9:hy0 + largo - 3, hx0 + 2:hx0 + 4] = (230, 236, 244)


def construir(origen: str, base: str) -> Image.Image:
    im = np.array(Image.open(f"{origen}/{base}").convert("RGB"))
    alto = sum(b - a for a, b in FIL_IZQ)
    assert alto == sum(b - a for a, b in FIL_CENT), "las franjas deben sumar la misma altura"
    cols = []
    for (x0, x1), filas in ((X_IZQ, FIL_IZQ), (X_PAS, FIL_CENT), (X_TRAB, FIL_CENT)):
        cols.append(apilar(im[:, x0:x1], filas))
    # El muro del pasillo en la franja repetida del descanso arrastraba el lavabo del baño: se rehace
    # con un tramo liso del muro de la sala de reuniones (misma geometría, sin objetos).
    ini = FIL_IZQ[0][1]; n = FIL_IZQ[1][1] - FIL_IZQ[1][0]
    cols[0][ini:ini + n, PARCHE_MURO[0]:PARCHE_MURO[1]] = im[PARCHE_MURO_DONANTE:PARCHE_MURO_DONANTE + n, PARCHE_MURO[0]:PARCHE_MURO[1]]
    out = np.concatenate(cols, axis=1)
    out = out[: alto - (941 - RECORTE_INFERIOR)].copy()
    for x0, x1, y0, y1, desp, dy, eje in PUERTAS:
        abrir_puerta(out, x0, x1, y0, y1, desp, dy, eje)
    return Image.fromarray(out)


if __name__ == "__main__":
    construir(sys.argv[1], sys.argv[2]).save(sys.argv[3])
    print("plano:", Image.open(sys.argv[3]).size)
