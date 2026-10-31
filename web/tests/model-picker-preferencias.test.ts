import { describe, expect, test } from "bun:test";
import { marcaAprobacion } from "../src/lib/actividad-chat";
import { normalizarIdAnalisis } from "../src/lib/model-picker-preferencias";

describe("identificadores del índice de Artificial Analysis", () => {
  test("ignora proveedor y variante de esfuerzo al comparar un modelo", () => {
    expect(normalizarIdAnalisis("opencode/anthropic/claude-sonnet-5-high")).toBe("claudesonnet5");
    expect(normalizarIdAnalisis("claude-sonnet-5")).toBe("claudesonnet5");
    expect(normalizarIdAnalisis("openrouter/meta/llama-4-scout:free")).toBe("llama4scout");
    expect(normalizarIdAnalisis("opencode/model-preview-free")).toBe("model");
  });

  test("una versión revisada nueva vuelve a marcar el chat pendiente", () => {
    const base = { id: "chat", title: "Chat", model: null, effort: null, project_id: null, project_name: null, pinned_at: null, cuota_modelo: null, created_at: "2026-10-17", pendiente_aprobacion: true, estado_tarea_id: "tarea" };
    expect(marcaAprobacion({ ...base, estado_tarea_version: "hash-a" })).not.toBe(marcaAprobacion({ ...base, estado_tarea_version: "hash-b" }));
  });
});
