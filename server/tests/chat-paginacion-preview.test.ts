import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/db";
import { config } from "../src/config";
import { chat, previewHtmlAutorizada } from "../src/routes/chat";
import { COOKIE_SESION, cerrarSesionPorToken, crearSesionDispositivo } from "../src/auth";

const app = new Hono().route("/api", chat);
const ids: string[] = [];
function conversacion() {
  const id = crypto.randomUUID(); ids.push(id);
  db.query("INSERT INTO conversations(id,title) VALUES (?,?)").run(id, "Prueba aislada");
  return id;
}
afterAll(() => { for (const id of ids) db.query("DELETE FROM conversations WHERE id=?").run(id); });

test("pagina en SQL con cursores estables aun con fechas iguales y acota consumidores antiguos", async () => {
  const id = conversacion();
  for (let n = 1; n <= 105; n++) db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,?,?)").run(`${id}-${n}`, id, "user", String(n));
  const pedir = async (parametros: string) => (await app.request(`/api/conversations/${id}/messages?pagina=1&${parametros}`)).json() as Promise<any>;
  const ultima = await pedir("limite=40");
  expect(ultima.messages).toHaveLength(40);
  expect(ultima.messages[0].content).toBe("66");
  expect(ultima.messages.at(-1).content).toBe("105");
  const anterior = await pedir(`antes=${ultima.anterior}&limite=40`);
  expect(anterior.messages[0].content).toBe("26");
  expect(anterior.messages.at(-1).content).toBe("65");
  expect((await (await app.request(`/api/conversations/${id}/messages`)).json() as any[])).toHaveLength(40);
  expect((await app.request(`/api/conversations/${id}/messages?pagina=1&antes=-1`)).status).toBe(400);
  expect((await app.request(`/api/conversations/${id}/messages?pagina=1&antes=3&despues=4`)).status).toBe(400);
});

test("el sondeo solo entrega novedades y reconcilia borrados y compactaciones", async () => {
  const id = conversacion();
  const insertar = (suffix: string, role: string) => db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,?,?)").run(`${id}-${suffix}`, id, role, suffix);
  insertar("usuario", "user"); insertar("aviso", "system");
  const inicial = await (await app.request(`/api/conversations/${id}/messages?pagina=1`)).json() as any;
  db.query("DELETE FROM messages WHERE id=?").run(`${id}-aviso`);
  db.query("UPDATE messages SET sesion_compactada=1 WHERE id=?").run(`${id}-usuario`);
  insertar("respuesta", "assistant");
  const delta = await (await app.request(`/api/conversations/${id}/messages?pagina=1&despues=${inicial.ultimo}&ultimoId=${id}-aviso&desde=${inicial.messages[0].cursor}`)).json() as any;
  expect(delta.reiniciar).toBe(true);
  expect(delta.messages.map((m: any) => m.content)).toEqual(["usuario", "respuesta"]);
  expect(delta.messages[0].sesion_compactada).toBe(1);
  const vacio = await (await app.request(`/api/conversations/${id}/messages?pagina=1&despues=${delta.ultimo}&desde=${inicial.messages[0].cursor}`)).json() as any;
  expect(vacio.messages.map((m: any) => m.content)).toEqual(["respuesta"]);
});

test("los cursores conservan el orden histórico por fecha aunque las inserciones no lo tengan", async () => {
  const id = conversacion();
  for (const dia of ["03", "01", "02"]) db.query("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES (?,?,'user',?,?)").run(`${id}-${dia}`, id, dia, `2026-10-${dia} 00:00:00`);
  const reciente = await (await app.request(`/api/conversations/${id}/messages?pagina=1&limite=2`)).json() as any;
  expect(reciente.messages.map((m: any) => m.content)).toEqual(["02", "03"]);
  const anterior = await (await app.request(`/api/conversations/${id}/messages?pagina=1&limite=2&antes=${reciente.anterior}`)).json() as any;
  expect(anterior.messages.map((m: any) => m.content)).toEqual(["01"]);
});

test("al retirar el primer aviso residente recupera la página completa aunque el último mensaje siga", async () => {
  const id = conversacion();
  for (const [nombre, rol] of [["aviso", "system"], ["peticion", "user"], ["respuesta", "assistant"]]) db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,?,?)").run(`${id}-${nombre}`, id, rol!, nombre!);
  const inicial = await (await app.request(`/api/conversations/${id}/messages?pagina=1`)).json() as any;
  db.query("DELETE FROM messages WHERE id=?").run(`${id}-aviso`);
  const respuesta = await app.request(`/api/conversations/${id}/messages?pagina=1&despues=${inicial.ultimo}&ultimoId=${id}-respuesta&desde=${inicial.messages[0].cursor}`);
  const pagina = await respuesta.json() as any;
  expect(respuesta.status).toBe(200); expect(pagina.reiniciar).toBe(true);
  expect(pagina.messages.map((m: any) => m.content)).toEqual(["peticion", "respuesta"]);
});

test("una página de respuestas conserva el turno para reintentar y abrir subagentes aunque el prompt esté fuera", async () => {
  const id = conversacion();
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Petición original')").run(`${id}-prompt`, id);
  for (let n = 0; n < 45; n++) db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'assistant',?)").run(`${id}-${n}`, id, `Parte ${n}`);
  const pagina = await (await app.request(`/api/conversations/${id}/messages?pagina=1`)).json() as any;
  expect(pagina.messages).toHaveLength(40);
  expect(pagina.messages.some((m: any) => m.role === "user")).toBe(false);
  expect(pagina.messages.every((m: any) => m.turno_id === `${id}-prompt` && typeof m.turno_created_at === "string")).toBe(true);
  const original = await app.request(`/api/conversations/${id}/messages/${id}-prompt`);
  expect((await original.json() as any).content).toBe("Petición original");
  expect((await app.request(`/api/conversations/${conversacion()}/messages/${id}-prompt`)).status).toBe(404);
});

test("HTML y recursos relativos usan una capacidad de raíz y sesión, nunca permisos del origen", async () => {
  const id = conversacion();
  const carpeta = join(config.dataDir, "chat-workspace", id, "demo");
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, "index.html"), '<link rel="stylesheet" href="estilo.css"><script type="module" src="app.js"></script><h1>Demo</h1>');
  writeFileSync(join(carpeta, "estilo.css"), "h1{color:red}");
  writeFileSync(join(carpeta, "app.js"), "document.body.dataset.funciona='si'");
  writeFileSync(join(carpeta, ".env"), "SECRETO_FICTICIO=fuera");
  const anterior = config.sinClave;
  const sesion = crearSesionDispositivo({});
  config.sinClave = false;
  try {
    const respuesta = await app.request(`/api/conversations/${id}/archivo-html?ruta=demo/index.html`, { headers: { Cookie: `${COOKIE_SESION}=${sesion.token}` } });
    expect(respuesta.status).toBe(302);
    const ubicacion = respuesta.headers.get("Location")!;
    const documento = await app.request(ubicacion);
    expect(documento.status).toBe(200);
    const csp = documento.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("sandbox allow-scripts;");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain("https:;");
    const recurso = ubicacion.replace("index.html", "estilo.css");
    expect(previewHtmlAutorizada(new Request(`http://localhost${recurso}`))).toBe(true);
    const css = await app.request(recurso);
    expect(css.status).toBe(200); expect(await css.text()).toBe("h1{color:red}");
    expect(css.headers.get("Content-Type")).toContain("text/css");
    expect(css.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await app.request(ubicacion.replace("index.html", ".env"))).status).toBe(415);
    expect((await app.request(ubicacion.replace(id, crypto.randomUUID()))).status).toBe(401);
    expect(previewHtmlAutorizada(new Request(`http://localhost${recurso}`, { method: "POST" }))).toBe(false);
    cerrarSesionPorToken(sesion.token);
    expect((await app.request(recurso)).status).toBe(401);
  } finally { config.sinClave = anterior; cerrarSesionPorToken(sesion.token); }
});
