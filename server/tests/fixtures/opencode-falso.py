#!/usr/bin/python3
"""Agente local determinista: prueba el protocolo sin proveedores ni credenciales."""
import json
import pathlib
import subprocess
import sys
import time


def evento(tipo, **datos):
    print(json.dumps({"type": tipo, "sessionID": "ses_fixture_worker", **datos}), flush=True)


args = sys.argv[1:]
modelo = args[args.index("-m") + 1]
prompt = args[-1]
evento("step_finish", part={"tokens": {"input": 17, "output": 5, "reasoning": 2, "cache": {"read": 3}}, "cost": 0.004})
if modelo == "opencode/fallo":
    print("fallo deliberado después de consumir tokens", file=sys.stderr)
    sys.exit(1)
if modelo == "opencode/cancelar":
    time.sleep(60)
    sys.exit(0)
if modelo == "opencode/lento":
    time.sleep(1.5)

if "Actúa SOLO como analizador" in prompt or "Eres el analizador de Telo" in prompt:
    try:
        pathlib.Path("escritura-analizador.txt").write_text("prohibido")
    except OSError:
        pass
    else:
        print("El analizador pudo escribir", file=sys.stderr)
        sys.exit(1)
    plan = {"objetivo": "Probar el flujo aislado", "supuestos": ["solo lectura verificada"],
            "pasos": [{"id": 1, "descripcion": "Crear el archivo aprobado", "archivos": ["permitido.txt"]}],
            "criterios_de_aceptacion": ["Se conserva el archivo aprobado"],
            "requiere_aprobacion": ["commit", "push"] if modelo == "opencode/git" else [],
            "riesgos": [], "preguntas": ["¿Confirmas el alcance de esta prueba?"]}
    if "Se detectaron cambios fuera del plan" in prompt:
        plan["objetivo"] = "Revisar extra.txt fuera del plan"
    evento("text", part={"text": json.dumps(plan)})
else:
    pathlib.Path("permitido.txt").write_text("trabajo conservado\n")
    intento = subprocess.run(["git", "-c", "user.name=Prueba", "-c", "user.email=prueba@example.invalid",
                              "commit", "--allow-empty", "-m", "prohibido"], capture_output=True, text=True)
    if intento.returncode == 0:
        print("El obrero pudo crear un commit", file=sys.stderr)
        sys.exit(1)
    if modelo == "opencode/fuera":
        pathlib.Path("extra.txt").write_text("fuera del plan, conservar\n")
    if modelo == "opencode/fallo-reporte":
        # Siempre devuelve un reporte con fallo: la iniciativa del obrero agota sus ciclos.
        reporte = {"estado": "fallo", "resumen": "La verificación sigue fallando",
                   "cambios": [{"archivo": "permitido.txt", "tipo": "crear"}],
                   "pruebas": [{"comando": "prueba del proyecto", "resultado": "fallo"}],
                   "pendientes": [], "diff_disponible": True}
        evento("text", part={"text": json.dumps(reporte)})
        sys.exit(0)
    if modelo == "opencode/corrige" and "CORRECCIÓN DEL OBRERO" not in prompt:
        # Primer intento: verificación con fallo. El ciclo de corrección lo devuelve a la misma sesión.
        reporte = {"estado": "fallo", "resumen": "La verificación falla en el primer intento",
                   "cambios": [{"archivo": "permitido.txt", "tipo": "crear"}],
                   "pruebas": [{"comando": "prueba del proyecto", "resultado": "fallo"}],
                   "pendientes": [], "diff_disponible": True}
        evento("text", part={"text": json.dumps(reporte)})
        sys.exit(0)
    reporte = {"resumen": "Obrero aislado completado", "cambios": [{"archivo": "permitido.txt", "tipo": "crear"}],
               "pruebas": [{"comando": "git commit bloqueado", "resultado": "ok"}],
               "pendientes": [], "diff_disponible": True}
    evento("text", part={"text": json.dumps(reporte)})
