import { describe, expect, test } from "bun:test";
import { comprobarCI } from "../../deploy/verificar-ci";

type Solicitar = (input: string | URL, init?: RequestInit) => Promise<Response>;
const sha = "a".repeat(40);
const token = "github_pat_token_sintetico_solo_pruebas";
const run = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  path: ".github/workflows/ci.yml",
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  run_attempt: 1,
  created_at: "2026-10-31T10:00:00Z",
  ...overrides,
});
const jobs = (overrides: Record<string, unknown>[] = []) => ({ jobs: [
  { id: 1, name: "servidor", status: "completed", conclusion: "success", started_at: "2026-10-31T10:00:00Z" },
  { id: 2, name: "interfaz", status: "completed", conclusion: "success", started_at: "2026-10-31T10:01:00Z" },
  ...overrides,
] });

function respuestaGitHub(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

describe("puerta de CI del despliegue con PAT fine-grained", () => {
  test("consulta Actions para el SHA exacto y exige los dos jobs", async () => {
    const urls: string[] = [];
    const solicitar: Solicitar = async (input, init) => {
      urls.push(String(input));
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      if (urls.length === 1) return respuestaGitHub({ workflow_runs: [run({ head_sha: "b".repeat(40) }), run()] });
      return respuestaGitHub(jobs());
    };

    expect(await comprobarCI(sha, token, solicitar)).toEqual({ listo: true, motivo: "servidor e interfaz aprobaron CI" });
    expect(urls).toEqual([
      `https://api.github.com/repos/PABLOCESAR2412/Orquestador/actions/runs?head_sha=${sha}&per_page=100`,
      "https://api.github.com/repos/PABLOCESAR2412/Orquestador/actions/runs/42/jobs?filter=latest&per_page=100",
    ]);
  });

  test("elige la ejecución más reciente de push a main y no acepta una anterior verde", async () => {
    let llamadas = 0;
    const solicitar: Solicitar = async () => {
      llamadas++;
      return respuestaGitHub({ workflow_runs: [
        run({ id: 41, created_at: "2026-10-31T09:00:00Z" }),
        run({ id: 42, conclusion: "failure", created_at: "2026-10-31T10:00:00Z" }),
        run({ id: 43, event: "pull_request", created_at: "2026-10-31T11:00:00Z" }),
      ] });
    };

    expect(await comprobarCI(sha, token, solicitar)).toEqual({ listo: false, motivo: "workflow:failure" });
    expect(llamadas).toBe(1);
  });

  test("bloquea si falta un job o su resultado más reciente falló", async () => {
    const solicitar: Solicitar = async (_input, init) => {
      const url = String(_input);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      return url.includes("/jobs?")
        ? respuestaGitHub(jobs([{ id: 3, name: "servidor", status: "completed", conclusion: "failure", started_at: "2026-10-31T10:02:00Z" }]))
        : respuestaGitHub({ workflow_runs: [run()] });
    };

    expect(await comprobarCI(sha, token, solicitar)).toEqual({ listo: false, motivo: "servidor:failure" });
  });

  test("falla de forma cerrada ante token, SHA, respuesta o permiso inválidos", async () => {
    const sinLlamadas: Solicitar = async () => { throw new Error("no debe consultar"); };
    expect(await comprobarCI(sha, undefined, sinLlamadas)).toEqual({ listo: false, motivo: "token_ausente_o_invalido" });
    expect(await comprobarCI("no-es-sha", token, sinLlamadas)).toEqual({ listo: false, motivo: "sha_invalido" });
    expect(await comprobarCI(sha, token, async () => respuestaGitHub({ message: "Resource not accessible by personal access token" }, 403)))
      .toEqual({ listo: false, motivo: "github_http_403" });
    expect(await comprobarCI(sha, token, async () => respuestaGitHub({ message: "Not Found" })))
      .toEqual({ listo: false, motivo: "respuesta_invalida" });
  });
});
