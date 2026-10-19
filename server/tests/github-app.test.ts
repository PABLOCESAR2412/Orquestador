import { afterAll, afterEach, expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(tmpdir(), `telo-pruebas-github-app-${randomUUID()}`);
const rutaClave = join(tmpdir(), `telo-github-app-key-${randomUUID()}.pem`);
const dataDirOriginal = process.env.DATA_DIR;
if (!process.env.DATA_DIR) process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });

const appIdOriginal = process.env.TELO_GITHUB_APP_ID;
const rutaClaveOriginal = process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privadaPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.TELO_GITHUB_APP_ID = "123456";
writeFileSync(rutaClave, privadaPem, { mode: 0o600 });
process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH = rutaClave;

const { db } = await import("../src/db");
const { borrarInstalacionGithubApp, listarInstalacionesGithubApp, seleccionarInstalacionGithubApp, tokenGithubAppParaRepo } =
  await import("../src/github-app");
const { borrarCuentaGithubGlobal, guardarCuentaGithubGlobal } = await import("../src/github-auth");
const { githubApiPr } = await import("../src/routes/proyecto-config");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  borrarInstalacionGithubApp();
  borrarCuentaGithubGlobal();
});

afterAll(() => {
  if (appIdOriginal === undefined) delete process.env.TELO_GITHUB_APP_ID;
  else process.env.TELO_GITHUB_APP_ID = appIdOriginal;
  if (rutaClaveOriginal === undefined) delete process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH;
  else process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH = rutaClaveOriginal;
  rmSync(rutaClave, { force: true });
  if (dataDirOriginal === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataDirOriginal;
});

function revisarJwt(auth: string | null) {
  expect(auth).toStartWith("Bearer ");
  const jwt = auth!.slice("Bearer ".length);
  const [encabezado, carga, firma] = jwt.split(".");
  expect(JSON.parse(Buffer.from(encabezado, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(carga, "base64url").toString()) as { iss: string; iat: number; exp: number };
  expect(payload.iss).toBe("123456");
  expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60);
  expect(verify("RSA-SHA256", Buffer.from(`${encabezado}.${carga}`), publicKey, Buffer.from(firma, "base64url"))).toBe(true);
}

test("la App enumera solo instalaciones verificadas y guarda metadatos sin credenciales", async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    expect(String(url)).toBe("https://api.github.com/app/installations?per_page=100");
    revisarJwt(new Headers(init.headers).get("Authorization"));
    return Response.json([
      { id: 456, account: { login: "Pablo", name: "Pablo C", avatar_url: "https://avatars.githubusercontent.com/u/1" }, repository_selection: "selected", permissions: { contents: "write", pull_requests: "write" }, html_url: "https://github.com/settings/installations/456" },
      { id: 0, account: { login: "omitido" }, repository_selection: "all" },
    ]);
  }) as unknown as typeof fetch;

  const instalaciones = await listarInstalacionesGithubApp();
  expect(instalaciones).toEqual([
    { id: 456, login: "Pablo", name: "Pablo C", avatar_url: "https://avatars.githubusercontent.com/u/1", repository_selection: "selected", permissions: { contents: "write", pull_requests: "write" }, configuration_url: "https://github.com/settings/installations/456" },
  ]);
  const guardada = await seleccionarInstalacionGithubApp(456);
  expect(guardada.id).toBe(456);
  const fila = db.query<{ value: string }, []>("SELECT value FROM app_settings WHERE key='github_app_installation'").get();
  expect(fila?.value).not.toContain("token");
  expect(fila?.value).toContain("Pablo");
});

test("emite un token limitado al repo y al permiso solicitado, sin guardar el token", async () => {
  let llamada = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    llamada++;
    revisarJwt(new Headers(init.headers).get("Authorization"));
    if (llamada === 1) {
      expect(String(url)).toBe("https://api.github.com/app/installations?per_page=100");
      return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
    }
    expect(String(url)).toBe("https://api.github.com/app/installations/456/access_tokens");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      repositories: ["Orquestador"],
      permissions: { contents: "write" },
    });
    return Response.json({ token: "ghs-token-temporal", expires_at: "2026-10-15T13:00:00Z" });
  }) as unknown as typeof fetch;

  await seleccionarInstalacionGithubApp(456);
  expect(await tokenGithubAppParaRepo("https://github.com/Pablo/Orquestador.git", { contents: "write" })).toBe("ghs-token-temporal");
  expect(llamada).toBe(2);
  const fila = db.query<{ value: string }, []>("SELECT value FROM app_settings WHERE key='github_app_installation'").get();
  expect(fila?.value).not.toContain("ghs-token-temporal");
});

test("rechaza repositorios de otra cuenta sin solicitar un token más amplio", async () => {
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas++;
    return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
  }) as unknown as typeof fetch;
  await seleccionarInstalacionGithubApp(456);
  await expect(tokenGithubAppParaRepo("https://github.com/otra-cuenta/privado", { contents: "write" })).rejects.toMatchObject({
    code: "github_app_sin_acceso",
    status: 403,
  });
  expect(llamadas).toBe(1);
});

test("crear un PR prioriza el token temporal aunque exista una sesión anterior", async () => {
  let llamada = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    llamada++;
    if (llamada === 1) {
      expect(String(url)).toBe("https://api.github.com/app/installations?per_page=100");
      revisarJwt(new Headers(init.headers).get("Authorization"));
      return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
    }
    if (llamada === 2) {
      expect(String(url)).toBe("https://api.github.com/app/installations/456/access_tokens");
      expect(JSON.parse(String(init.body))).toEqual({
        repositories: ["Orquestador"],
        permissions: { pull_requests: "write" },
      });
      return Response.json({ token: "ghs-pr-temporal" });
    }
    expect(String(url)).toBe("https://api.github.com/repos/Pablo/Orquestador/pulls");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer ghs-pr-temporal");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Cambios", head: "feat/prueba", base: "main" });
    return Response.json({ html_url: "https://github.com/Pablo/Orquestador/pull/8" });
  }) as unknown as typeof fetch;
  guardarCuentaGithubGlobal({
    token: "github_pat_legado_muy_secreto",
    login: "Pablo",
    name: "Pablo",
    avatar_url: "",
    scopes: ["repo"],
    actualizado_en: new Date().toISOString(),
  });
  await seleccionarInstalacionGithubApp(456);
  const respuesta = await githubApiPr("sin-proyecto", "/repos/Pablo/Orquestador/pulls", {
    tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "Pablo", instalacion_id: 456,
  }, {
    title: "Cambios",
    head: "feat/prueba",
    base: "main",
  });
  expect(respuesta).toEqual({ html_url: "https://github.com/Pablo/Orquestador/pull/8" });
  expect(llamada).toBe(3);
});

test("hacer merge solicita a la GitHub App el permiso Contents de escritura", async () => {
  let llamada = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    llamada++;
    if (llamada === 1) {
      expect(String(url)).toBe("https://api.github.com/app/installations?per_page=100");
      return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
    }
    if (llamada === 2) {
      expect(String(url)).toBe("https://api.github.com/app/installations/456/access_tokens");
      expect(JSON.parse(String(init.body))).toEqual({
        repositories: ["Orquestador"],
        permissions: { contents: "write" },
      });
      return Response.json({ token: "ghs-merge-temporal" });
    }
    expect(String(url)).toBe("https://api.github.com/repos/Pablo/Orquestador/pulls/8/merge");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer ghs-merge-temporal");
    expect(JSON.parse(String(init.body))).toEqual({ commit_title: "Merge #8", merge_method: "squash" });
    return Response.json({ merged: true, sha: "abc123" });
  }) as unknown as typeof fetch;
  await seleccionarInstalacionGithubApp(456);

  const resultado = await githubApiPr("sin-proyecto", "/repos/Pablo/Orquestador/pulls/8/merge", {
    tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "Pablo", instalacion_id: 456,
  }, { commit_title: "Merge #8", merge_method: "squash" }, "PUT", "merge");

  expect(resultado).toEqual({ merged: true, sha: "abc123" });
  expect(llamada).toBe(3);
});

test("un 405 al fusionar indica que el Pull Request no está listo para fusionarse", async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith("/app/installations?per_page=100")) {
      return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
    }
    if (String(url).endsWith("/app/installations/456/access_tokens")) {
      return Response.json({ token: "ghs-merge-temporal" });
    }
    return Response.json({ message: "Pull Request is not mergeable" }, { status: 405 });
  }) as unknown as typeof fetch;
  await seleccionarInstalacionGithubApp(456);

  await expect(githubApiPr("sin-proyecto", "/repos/Pablo/Orquestador/pulls/8/merge", {
    tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "Pablo", instalacion_id: 456,
  }, { commit_title: "Merge #8", merge_method: "squash" }, "PUT", "merge")).rejects.toThrow(
    "GitHub indica que este Pull Request no se puede fusionar ahora; puede tener conflictos o requisitos de rama pendientes. Corrígelos en GitHub y solicita una nueva autorización de merge.",
  );
});

test("al crear un PR, GitHub expone el detalle de una respuesta 422", async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith("/app/installations?per_page=100")) {
      return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
    }
    if (String(url).endsWith("/app/installations/456/access_tokens")) {
      return Response.json({ token: "ghs-pr-temporal" });
    }
    return new Response(JSON.stringify({
      message: "Validation Failed",
      errors: [{ resource: "PullRequest", field: "head", code: "custom", message: "A pull request already exists for this head and base." }],
    }), { status: 422, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;

  await seleccionarInstalacionGithubApp(456);
  await expect(githubApiPr("sin-proyecto", "/repos/Pablo/Orquestador/pulls", {
    tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "Pablo", instalacion_id: 456,
  }, {
    title: "Cambios",
    head: "feat/prueba",
    base: "main",
  })).rejects.toThrow(
    "GitHub no pudo completar la acción (422): Validation Failed; head: A pull request already exists for this head and base.",
  );
});

test("un 422 sin commits explica que hay que subir cambios a la rama origen", async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith("/app/installations?per_page=100")) {
      return Response.json([{ id: 456, account: { login: "Pablo" }, repository_selection: "selected" }]);
    }
    if (String(url).endsWith("/app/installations/456/access_tokens")) {
      return Response.json({ token: "ghs-pr-temporal" });
    }
    return new Response(JSON.stringify({
      message: "Validation Failed",
      errors: [{ resource: "PullRequest", field: "head", code: "invalid", message: "No commits between main and telo/0e680496; not all refs are readable" }],
    }), { status: 422, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  await seleccionarInstalacionGithubApp(456);
  await expect(githubApiPr("sin-proyecto", "/repos/Pablo/Orquestador/pulls", {
    tipo: "github_app", origen: "app", etiqueta: "GitHub App", cuenta: "Pablo", instalacion_id: 456,
  }, {
    title: "Cambios",
    head: "telo/0e680496",
    base: "main",
  })).rejects.toThrow(
    "GitHub no ve commits nuevos entre la rama de Telo y la rama base. Comprueba que el commit se haya subido a la rama indicada y que la rama base sea correcta; después prepara una nueva autorización de PR.",
  );
});
