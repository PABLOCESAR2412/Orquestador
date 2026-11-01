import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "../src/config";
import { db } from "../src/db";
import { sesionValida, crearSesionDispositivo, cerrarSesionPorToken } from "../src/auth";
import { settings } from "../src/routes/settings";
import { chat } from "../src/routes/chat";
import { Hono } from "hono";
import { capturarAlcance, comprobarAlcance } from "../src/alcance-plan";
import { actividadDelGrupo } from "../src/runners/actividad-grupo";

const raiz = mkdtempSync(join(tmpdir(), "telo-auditoria-regresion-"));
// La raíz del directorio temporal en sí: el guard exige bases estrictamente debajo de él,
// así que la rechaza independientemente de dónde viva el repositorio (un clon dentro de
// %TEMP% haría que su propio `../data` pareciera permitido).
const baseProhibida = tmpdir();
const chats: string[] = [];
afterAll(() => { for (const id of chats) db.query("DELETE FROM conversations WHERE id = ?").run(id); });
function conversacion() {
 const id = crypto.randomUUID(); chats.push(id);
 db.query("INSERT INTO conversations(id,title) VALUES (?,?)").run(id,"Original");
 return id;
}
test("rechaza cookies heredadas y revoca las sesiones nuevas", () => {
 const anterior = { clave: config.clave, sinClave: config.sinClave };
 try {
  config.sinClave = false; config.clave = "clave-ficticia-de-auditoria";
  const vieja = createHmac("sha256", config.clave).update("telo-sesion-v1").digest("hex");
  expect(sesionValida(vieja)).toBe(false);
  const nueva = crearSesionDispositivo({});
  expect(sesionValida(nueva.token)).toBe(true);
  cerrarSesionPorToken(nueva.token);
  expect(sesionValida(nueva.token)).toBe(false);
 } finally { Object.assign(config, anterior); }
});
test("un PATCH rechazado no cambia título ni anclado", async () => {
 const id=conversacion();
 const respuesta=await settings.request(`/conversations/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"No guardar",pinned:true,effort:"high"})});
 expect(respuesta.status).toBe(400);
 expect(db.query("SELECT title,pinned_at FROM conversations WHERE id=?").get(id)).toEqual({title:"Original",pinned_at:null});
 const valida=await settings.request(`/conversations/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Actualizado",pinned:true})});
 expect(valida.status).toBe(200);
 expect((await valida.json() as { title: string }).title).toBe("Actualizado");
});

test("heredar el modelo desactiva selecciones antiguas sin perderlas ni validarlas", async () => {
 const id=conversacion();
 const anteriores=[{rol:"seguridad",model:"opencode/modelo-retirado"}];
 db.query("UPDATE conversations SET model=?,orquestacion_habilitada=1,orquestacion_modelos_personalizados=1,orquestacion_trabajadores=? WHERE id=?").run("google/gemini-flash",JSON.stringify(anteriores),id);
 const respuesta=await settings.request(`/conversations/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({orquestacion_modelos_personalizados:false,orquestacion_trabajadores:anteriores})});
 expect(respuesta.status).toBe(200);
 const guardado=await respuesta.json() as {orquestacion_modelos_personalizados:boolean;orquestacion_trabajadores:unknown};
 expect(guardado.orquestacion_modelos_personalizados).toBe(false);
 expect(guardado.orquestacion_trabajadores).toEqual(anteriores);
 const listado=await chat.request("/conversations");
 const conversaciones=await listado.json() as {id:string;orquestacion_modelos_personalizados:boolean}[];
 expect(conversaciones.find((item)=>item.id===id)?.orquestacion_modelos_personalizados).toBe(false);
 const invalida=await settings.request(`/conversations/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"No guardar",orquestacion_modelos_personalizados:"true"})});
 expect(invalida.status).toBe(400);
 expect(db.query("SELECT title,orquestacion_modelos_personalizados FROM conversations WHERE id=?").get(id)).toEqual({title:"Original",orquestacion_modelos_personalizados:0});
});
test("preview HTML sirve scripts con sandbox y rechaza rutas ajenas", async () => {
 const id=conversacion();const carpeta=join(config.dataDir,"chat-workspace",id);mkdirSync(carpeta,{recursive:true});
 writeFileSync(join(carpeta,"demo.html"),"<h1>Demo</h1><script>document.body.dataset.activo='si'</script>");
 const app=new Hono().route("/api",chat);
 const sesion=crearSesionDispositivo({});
 const inicial=await app.request(`/api/conversations/${id}/archivo-html?ruta=demo.html`,{headers:{Cookie:`telo_sesion=${sesion.token}`}});
 expect(inicial.status).toBe(302);
 const respuesta=await app.request(inicial.headers.get("Location")!);
 expect(respuesta.status).toBe(200);
 expect(respuesta.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts");
 expect(respuesta.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
 expect(await respuesta.text()).toContain("<script>");
 cerrarSesionPorToken(sesion.token);
 expect((await chat.request(`/conversations/${id}/archivo-html?ruta=../demo.html`)).status).toBe(400);
});
test("el alcance funciona sin Git y no excluye prefijos .opencode parecidos", async () => {
 const cwd=join(raiz,"sin-git");mkdirSync(cwd);writeFileSync(join(cwd,"permitido.txt"),"original");
 const snapshot=await capturarAlcance(cwd,["permitido.txt"]);
 writeFileSync(join(cwd,"permitido.txt"),"aprobado");
 writeFileSync(join(cwd,".opencode-fuera.ts"),"fuera");
 expect(await comprobarAlcance(snapshot)).toEqual([".opencode-fuera.ts"]);
});
test("la actividad de una herramienta silenciosa se mide por CPU e IO del grupo", () => {
 const proc=join(raiz,"proc");mkdirSync(join(proc,"123"),{recursive:true});
 const campos=Array(22).fill("0");campos[0]="R";campos[2]="99";campos[11]="1";
 writeFileSync(join(proc,"123","stat"),`123 (render con espacios) ${campos.join(" ")}`);
 writeFileSync(join(proc,"123","io"),"write_bytes: 0");
 const inicial=actividadDelGrupo(99,proc);expect(inicial).not.toBeNull();
 expect(actividadDelGrupo(99,proc)).toBe(inicial);
 campos[11]="80";writeFileSync(join(proc,"123","stat"),`123 (render con espacios) ${campos.join(" ")}`);
 expect(actividadDelGrupo(99,proc)).not.toBe(inicial);
 const cpu=actividadDelGrupo(99,proc);writeFileSync(join(proc,"123","io"),"write_bytes: 4096");
 expect(actividadDelGrupo(99,proc)).not.toBe(cpu);
 expect(actividadDelGrupo(77,proc)).toBeNull();
});
test("el respaldo restaura documentos entregables con su contenido", async () => {
 const datos=join(raiz,"datos"),copias=join(raiz,"copias"),restaurado=join(raiz,"restaurado");
 mkdirSync(join(datos,"entregables","workspace"),{recursive:true});mkdirSync(restaurado);
 const origen=new Database(join(datos,"orquestador.db"));origen.exec("CREATE TABLE ejemplo(id INTEGER)");origen.close();
 mkdirSync(join(datos,"chat-attachments"),{recursive:true});writeFileSync(join(datos,"chat-attachments","adjunto.txt"),"Adjunto conservado");
 writeFileSync(join(datos,"entregables","workspace","reporte.html"),"<h1>Contenido recuperable</h1>");
 const proceso=Bun.spawn([process.execPath,"--no-env-file",resolve(import.meta.dir,"../scripts/respaldo.ts")],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,DATA_DIR:datos,TELO_RESPALDOS_DIR:copias,TELO_RESPALDO_PRUEBA_AISLADA:"1"},stdout:"pipe",stderr:"pipe"});
 const error=await new Response(proceso.stderr).text();expect(await proceso.exited,error).toBe(0);
 const tar=readdirSync(copias).find(n=>n.endsWith(".tar.gz"))!;
 expect(Bun.spawnSync(["tar","-xzf",join(copias,tar),"-C",restaurado]).exitCode).toBe(0);
 expect(readFileSync(join(restaurado,"chat-attachments","adjunto.txt"),"utf8")).toBe("Adjunto conservado");
 expect(readFileSync(join(restaurado,"entregables","workspace","reporte.html"),"utf8")).toBe("<h1>Contenido recuperable</h1>");
});

test("el bootstrap rechaza una base fuera del temporal antes de abrirla", () => {
 const anterior=process.env.DATA_DIR;
 try {
  process.env.DATA_DIR=baseProhibida;
  expect(() => db.query("SELECT 1")).toThrow("Las pruebas solo pueden abrir bases dentro del directorio temporal.");
 } finally { process.env.DATA_DIR=anterior; }
});

test("el guard no duerme si el preload no cargó: bun test activa NODE_ENV", () => {
 const anterior=process.env.DATA_DIR,bandera=process.env.TELO_PRUEBAS_BASE_AISLADA;
 try {
  delete process.env.TELO_PRUEBAS_BASE_AISLADA;
  process.env.DATA_DIR=baseProhibida;
  expect(() => db.query("SELECT 1")).toThrow("Las pruebas solo pueden abrir bases dentro del directorio temporal.");
 } finally {
  if (bandera===undefined) delete process.env.TELO_PRUEBAS_BASE_AISLADA; else process.env.TELO_PRUEBAS_BASE_AISLADA=bandera;
  process.env.DATA_DIR=anterior;
 }
});

test("un .git inválido no se trata como workspace libre", async () => {
 const cwd=join(raiz,"git-invalido");mkdirSync(cwd);
 writeFileSync(join(cwd,".git"),"gitdir: /otro/repositorio");
 await expect(capturarAlcance(cwd,["permitido.txt"])).rejects.toThrow("repositorio Git seguro");
});
