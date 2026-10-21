import type { RepositoryAction } from "../api";

export type PullRequestLink = { url: string; number: number };

function enlaceValido(url: unknown, numeroEsperado?: number): PullRequestLink | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    const match = /^\/[^/]+\/[^/]+\/pull\/(\d+)\/?$/.exec(parsed.pathname);
    if (parsed.origin !== "https://github.com" || !match) return null;
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number < 1 || (numeroEsperado !== undefined && number !== numeroEsperado)) return null;
    return { url: parsed.toString(), number };
  } catch {
    return null;
  }
}

/** Solo enlaza PRs creados con éxito o PRs existentes a los que apunta una acción de merge. */
export function pullRequestLink(accion: Pick<RepositoryAction, "action" | "state" | "payload" | "result">): PullRequestLink | null {
  if (accion.action === "merge" || accion.action === "push") {
    try {
      const payload = JSON.parse(accion.payload) as { pr_url?: unknown; pr_number?: unknown; source_pr_number?: unknown };
      const referencia = accion.action === "merge" ? payload.pr_number : payload.source_pr_number;
      const numero = Number.isSafeInteger(referencia) && typeof referencia === "number"
        ? referencia
        : undefined;
      return enlaceValido(payload.pr_url, numero);
    } catch {
      return null;
    }
  }

  if (accion.action !== "pr" || accion.state !== "approved" || !accion.result) return null;
  try {
    const result = JSON.parse(accion.result) as { url?: unknown; number?: unknown };
    const numero = Number.isSafeInteger(result.number) && typeof result.number === "number"
      ? result.number
      : undefined;
    if (numero === undefined) return null;
    return enlaceValido(result.url, numero);
  } catch {
    return null;
  }
}
