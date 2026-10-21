import { describe, expect, test } from "bun:test";
import { pullRequestLink } from "../src/lib/pull-request-link";

describe("enlace de Pull Request en las acciones Git", () => {
  test("no muestra un enlace de creación si GitHub rechazó el PR", () => {
    expect(pullRequestLink({
      action: "pr",
      state: "failed",
      payload: JSON.stringify({ pr_url: "https://github.com/PABLOCESAR2412/Cubo/pull/" }),
      result: "Validation Failed: A pull request already exists for PABLOCESAR2412:telo/cambio",
    })).toBeNull();
  });

  test("muestra el enlace confirmado por GitHub después de crear el PR", () => {
    expect(pullRequestLink({
      action: "pr",
      state: "approved",
      payload: JSON.stringify({ pr_url: "https://github.com/PABLOCESAR2412/Cubo/pull/" }),
      result: JSON.stringify({ url: "https://github.com/PABLOCESAR2412/Cubo/pull/42", number: 42 }),
    })).toEqual({ url: "https://github.com/PABLOCESAR2412/Cubo/pull/42", number: 42 });
  });

  test("conserva el enlace de un PR existente cuando falla su merge", () => {
    expect(pullRequestLink({
      action: "merge",
      state: "failed",
      payload: JSON.stringify({ pr_url: "https://github.com/PABLOCESAR2412/Cubo/pull/42", pr_number: 42 }),
      result: "El PR requiere resolver conflictos",
    })).toEqual({ url: "https://github.com/PABLOCESAR2412/Cubo/pull/42", number: 42 });
  });

  test("conserva el enlace al subir cambios a la rama de un PR existente", () => {
    expect(pullRequestLink({
      action: "push",
      state: "approved",
      payload: JSON.stringify({ pr_url: "https://github.com/PABLOCESAR2412/Cubo/pull/42", source_pr_number: 42 }),
      result: JSON.stringify({ sha: "abcdef012345" }),
    })).toEqual({ url: "https://github.com/PABLOCESAR2412/Cubo/pull/42", number: 42 });
  });

  test("descarta destinos que no son un enlace canónico de GitHub", () => {
    for (const url of ["https://example.com/pull/42", "https://github.com:8443/PABLOCESAR2412/Cubo/pull/42"]) {
      expect(pullRequestLink({
        action: "pr",
        state: "approved",
        payload: "{}",
        result: JSON.stringify({ url, number: 42 }),
      })).toBeNull();
    }
  });
});
