"""Procesa los assets de la oficina (personajes, escritorios, mesa y plano) a atlas WebP livianos.

Se ejecuta a mano cuando cambian los originales; sus salidas SÍ se versionan, los originales NO.
Uso (desde web/): python3 -I scripts/oficina-assets.py <carpeta-originales> [salida=public/oficina]
Escribe además src/lib/oficina-manifiesto.json (tamaños de celda, anclas y asientos).
Requiere Pillow, numpy y scipy. Los nombres de archivo de los originales están en oficina-fuentes.json.

Pasos: limpia el halo verde de la clave cromática, segmenta cada hoja por proyección de la
transparencia (la rejilla de las hojas de caminar NO es uniforme), normaliza la escala por ancho de
cabeza, ancla por la cabeza (la cola de fantasma cambia de largo según la dirección) y empaqueta.
Falla con un mensaje claro si una hoja no trae los cuadros esperados.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

AQUI = Path(__file__).resolve().parent
ESCALA_ATLAS = 2            # píxeles de atlas por píxel de plano (pantallas densas y zoom)
CABEZA = 32                 # ancho de cabeza en el atlas (16 px de plano)
PAD = 4
FRAC_SENTADO = 0.66         # parte superior de la figura que queda visible sentada (hasta el dobladillo)
DIRECCIONES = ["frente", "espalda", "derecha", "izquierda"]   # orden de las filas de las hojas de caminar
ESC_ANCHO_PLANO = 150       # ancho del escritorio en el plano
MESA_ANCHO_PLANO = 545


def limpiar(im: Image.Image) -> Image.Image:
    """Quita el borde verde de la clave cromática (píxeles verdosos semitransparentes)."""
    a = np.array(im.convert("RGBA")); r, g, b, al = (a[..., i].astype(int) for i in range(4))
    a[..., 3][(al > 0) & (al < 250) & ((g - b) > 40) & ((g - r) > 20)] = 0
    return Image.fromarray(a)


def recortar(im: Image.Image) -> Image.Image:
    bb = im.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
    return im.crop(bb)


def tramos(v, minimo):
    res, ini = [], None
    for i, x in enumerate(v):
        if x and ini is None:
            ini = i
        if not x and ini is not None:
            res.append((ini, i)); ini = None
    if ini is not None:
        res.append((ini, len(v)))
    return [t for t in res if t[1] - t[0] > minimo]


def frames_caminar(im, nombre):
    m = np.array(im)[..., 3] > 128
    filas = tramos(m.any(axis=1), 30)
    if len(filas) != 4:
        sys.exit(f"{nombre}: se esperaban 4 filas de personaje y hay {len(filas)}")
    res = []
    for (y0, y1) in filas:
        cols = tramos(m[y0:y1].any(axis=0), 20)
        if len(cols) != 4:
            sys.exit(f"{nombre}: se esperaban 4 cuadros por fila y hay {len(cols)} (fila desde y={y0})")
        res.append([recortar(im.crop((x0, y0, x1, y1))) for (x0, x1) in cols])
    return res


def frames_trabajar(im, corte, nombre):
    anchos = tramos((np.array(im)[..., 3] > 128).any(axis=0), 20)
    if len(anchos) != 4:
        sys.exit(f"{nombre}: se esperaban 4 cuadros de trabajo y hay {len(anchos)}")
    res = []
    for (x0, x1) in anchos:
        f = recortar(im.crop((x0, 0, x1, im.height)))
        res.append(f.crop((0, 0, f.width, int(f.height * corte))))
    return res


def ancho_cabeza(f):
    m = np.array(f)[..., 3] > 128; h = max(1, int(m.shape[0] * .22))
    return float(np.mean([np.ptp(np.where(r)[0]) for r in m[:h] if r.any()]))


def centro_cabeza(f):
    m = np.array(f)[..., 3] > 128; h = max(1, int(m.shape[0] * .22))
    xs = np.where(m[:h])[1]
    return float(xs.mean())


def escalar(f, s):
    g = f.resize((max(1, round(f.width * s)), max(1, round(f.height * s))), Image.LANCZOS)
    a = np.array(g); a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)
    return Image.fromarray(a)


def guardar_webp(im, ruta, calidad=82):
    im.save(ruta, "WEBP", quality=calidad, alpha_quality=100, method=6)
    return Path(ruta).stat().st_size


def procesar(origen: Path, salida: Path):
    fuentes = json.loads((AQUI / "oficina-fuentes.json").read_text())
    salida.mkdir(parents=True, exist_ok=True)
    abrir = lambda n: limpiar(Image.open(origen / n))

    # 1) Personajes ---------------------------------------------------------------------------
    crudo = {}
    for nombre, cfg in fuentes["personajes"].items():
        cam = frames_caminar(abrir(cfg["caminar"]), f"{nombre} (caminar)")
        tra = frames_trabajar(abrir(cfg["trabajar"]), cfg["corte_trabajar"], f"{nombre} (trabajar)")
        sc = CABEZA / np.mean([ancho_cabeza(f) for f in cam[0]])
        st = CABEZA / np.mean([ancho_cabeza(f) for f in tra])
        crudo[nombre] = ([[escalar(f, sc) for f in fila] for fila in cam], [escalar(f, st) for f in tra])

    # tamaños de celda: el mayor de todos los personajes
    mitad_w = max(max(abs(centro_cabeza(f)), f.width - centro_cabeza(f)) for c, _ in crudo.values() for fila in c for f in fila)
    cw = int(2 * np.ceil(mitad_w) + 2 * PAD)
    ch = int(max(f.height for c, _ in crudo.values() for fila in c for f in fila) + 2 * PAD)
    mitad_t = max(max(centro_cabeza(f), f.width - centro_cabeza(f)) for _, t in crudo.values() for f in t)
    tw = int(2 * np.ceil(mitad_t) + 2 * PAD)
    th = int(max(f.height for _, t in crudo.values() for f in t) + 2 * PAD)
    sh = int(max(f.height for c, _ in crudo.values() for fila in c for f in fila[:1]) * FRAC_SENTADO) + 2 * PAD

    peso = 0
    for nombre, (cam, tra) in crudo.items():
        atlas = Image.new("RGBA", (cw * 4, ch * 4 + sh), (0, 0, 0, 0))
        for r, fila in enumerate(cam):
            for c, f in enumerate(fila):
                atlas.alpha_composite(f, (int(c * cw + cw / 2 - centro_cabeza(f)), r * ch + PAD))
        for c, d in enumerate(DIRECCIONES):          # fila de sentado: busto del primer cuadro de cada dirección
            f = cam[c][0]; busto = f.crop((0, 0, f.width, int(f.height * FRAC_SENTADO)))
            atlas.alpha_composite(busto, (int(c * cw + cw / 2 - centro_cabeza(f)), 4 * ch + sh - PAD - busto.height))
        peso += guardar_webp(atlas, salida / f"{nombre}-caminar.webp")
        trab = Image.new("RGBA", (tw * 4, th), (0, 0, 0, 0))
        for c, f in enumerate(tra):                    # alineado por abajo (la cintura queda en la silla)
            trab.alpha_composite(f, (int(c * tw + tw / 2 - centro_cabeza(f)), th - PAD - f.height))
        peso += guardar_webp(trab, salida / f"{nombre}-trabajar.webp")

    # 2) Muebles -------------------------------------------------------------------------------
    ap, en, mesa = abrir(fuentes["escritorio_apagado"]), abrir(fuentes["escritorio_encendido"]), abrir(fuentes["mesa"])
    bb = [im.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox() for im in (ap, en)]
    caja = (min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb))
    s_esc = ESCALA_ATLAS * ESC_ANCHO_PLANO / (caja[2] - caja[0])
    esc = {}
    for clave, im in (("apagado", ap), ("encendido", en)):
        g = escalar(im.crop(caja), s_esc); peso += guardar_webp(g, salida / f"escritorio-{clave}.webp"); esc[clave] = g.size
    # asiento (centro de la silla) medido sobre el original: x=675, y=800 en el lienzo de 1374×1145
    asiento_esc = [round((675 - caja[0]) * s_esc), round((800 - caja[1]) * s_esc)]
    cm = mesa.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
    s_mesa = ESCALA_ATLAS * MESA_ANCHO_PLANO / (cm[2] - cm[0])
    gm = escalar(mesa.crop(cm), s_mesa); peso += guardar_webp(gm, salida / "mesa.webp")
    xs = [355, 710, 1065, 1420]
    asientos_mesa = (
        [{"x": round((x - cm[0]) * s_mesa), "y": round((236 - cm[1]) * s_mesa), "dir": "frente"} for x in xs]
        + [{"x": round((x - cm[0]) * s_mesa), "y": round((790 - cm[1]) * s_mesa), "dir": "espalda"} for x in xs]
    )

    # 3) Plano ---------------------------------------------------------------------------------
    espec = importlib.util.spec_from_file_location("oficina_plano", AQUI / "oficina-plano.py")
    mod = importlib.util.module_from_spec(espec); espec.loader.exec_module(mod)
    plano = mod.construir(str(origen), fuentes["plano"])
    peso += guardar_webp(plano, salida / "plano.webp", calidad=80)

    manifiesto = {
        "escala_atlas": ESCALA_ATLAS,
        "plano": {"archivo": "plano.webp", "ancho": plano.width, "alto": plano.height},
        "personajes": sorted(crudo),
        "caminar": {
            "celda": [cw, ch], "cuadros": 4, "filas": {d: i for i, d in enumerate(DIRECCIONES)},
            "ancla": [cw // 2, PAD + round(0.72 * (ch - 2 * PAD))],
            "sentado": {"celda": [cw, sh], "y": 4 * ch, "ancla": [cw // 2, sh - PAD]},
            "cabeza": [cw // 2, PAD],
        },
        "trabajar": {"celda": [tw, th], "cuadros": 4, "ancla": [tw // 2, th - PAD]},
        "escritorio": {"apagado": "escritorio-apagado.webp", "encendido": "escritorio-encendido.webp",
                       "tamano": list(esc["apagado"]), "asiento": asiento_esc},
        "mesa": {"archivo": "mesa.webp", "tamano": list(gm.size), "asientos": asientos_mesa},
    }
    (AQUI.parent / "src" / "lib" / "oficina-manifiesto.json").write_text(json.dumps(manifiesto, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"celdas: caminar {cw}×{ch} sentado {cw}×{sh} trabajar {tw}×{th}; peso total ≈ {peso / 1024:.0f} KB")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    procesar(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else AQUI.parent / "public" / "oficina")
