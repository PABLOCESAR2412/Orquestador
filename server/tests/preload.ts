import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Se ejecuta incluso al seleccionar una sola suite; nunca hereda una base real del entorno.
const raiz = mkdtempSync(join(tmpdir(), "telo-test-run-"));
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "projects");
process.env.TELO_PRUEBAS_BASE_AISLADA = "1";
