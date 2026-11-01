import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Writable, Readable } from "node:stream";

const raiz = mkdtempSync(join(tmpdir(), "telo-red-"));
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
process.env.TELO_AISLAMIENTO = "activado";
const llamadas: any[] = [];
const peticionHttps = (opciones: any, respuesta: any) => {
  const chunks: Buffer[] = [];
  const peticion = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    final(callback) {
      llamadas.push({ ...opciones, body: Buffer.concat(chunks).toString() });
      const stream = Readable.from(['{"ok":true}']) as any;
      stream.statusCode = 200; stream.headers = { "content-type": "application/json" };
      respuesta(stream); callback();
    } });
  (peticion as any).setTimeout = () => peticion;
  return peticion;
};
const { prepararRedAgente, destinoPublico } = await import("../../src/runners/red-agente");
const { prefijoAislamiento, prepararPerfilOpenCode } = await import("../../src/runners/aislamiento");
const cwd = join(process.env.DATA_DIR!, "chat-workspace/prueba"); mkdirSync(cwd, { recursive: true });
const host = createServer((_req, res) => res.end("servicio privado"));
await new Promise<void>((r) => host.listen(0, "127.0.0.1", r));
const port = (host.address() as { port: number }).port;
const red = await prepararRedAgente({ modelos: ["openrouter/proveedor/modelo"], extraEnv: { OPENROUTER_API_KEY: "clave-sintetica-no-real" }, brokerOpenCode: true }, {
  resolver: (host) => host === "openrouter.ai" ? Promise.resolve("93.184.216.34") : destinoPublico(host), https: peticionHttps as any,
});
try {
  assert(!readFileSync(join(red.directorio, "auth.json"), "utf8").includes("clave-sintetica-no-real"));
  const perfil = prepararPerfilOpenCode("prueba-red");
  const python = `import json,os,socket,urllib.request,urllib.error
s=socket.socket();s.settimeout(2)
assert s.connect_ex(('127.0.0.1',${port})) != 0, 'loopback del host accesible'
assert not os.path.exists('/run/docker.sock')
assert not os.path.exists(os.path.expanduser('~/.local/share/opencode/auth.json'))
proxy=urllib.request.build_opener(urllib.request.ProxyHandler({'http':'http://127.0.0.1:18081'}))
# No se usa NO_PROXY al comprobar el bloqueo explícito del broker.
os.environ['no_proxy']='';os.environ['NO_PROXY']=''
for destino in ['http://127.0.0.1:${port}/','http://169.254.169.254/metadata/instance']:
 try: proxy.open(destino,timeout=4);raise Exception('destino privado accesible')
 except urllib.error.HTTPError as e: assert e.code==403
def inferir(modelo):
 req=urllib.request.Request('http://127.0.0.1:18081/telo-inference/openrouter/api/v1/chat/completions',data=json.dumps({'model':modelo,'messages':[]}).encode(),headers={'Content-Type':'application/json'})
 return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=4)
assert json.load(inferir('proveedor/modelo'))['ok']
try: inferir('otro/modelo');raise Exception('modelo no autorizado')
except urllib.error.HTTPError as e: assert e.code==403
print('aislamiento y broker verificados')`;
  const p = Bun.spawn([...prefijoAislamiento(cwd, true, [], perfil, undefined, undefined, undefined, undefined, undefined, red.directorio), "python3", "-c", python], {
    cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...red.entorno }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  assert.equal(code, 0, out + err);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].headers.authorization, "Bearer clave-sintetica-no-real");
  assert.equal(llamadas[0].hostname, "93.184.216.34");
  assert.equal(llamadas[0].servername, "openrouter.ai");
  assert.equal(llamadas[0].path, "/api/v1/chat/completions");
  const { prepararSubagentes } = await import("../../src/subagentes");
  const nativo = await prepararSubagentes({ prompt: "Usa subagentes", modelo: "openrouter/proveedor/modelo", idEjecucion: "native-usage", listarModelos: async () => [] });
  assert(nativo);
  const programa = `const {TeloSubagentes}=await import('file:///tmp/telo-opencode-config/plugins/telo-subagentes.js');
    const plugin=await TeloSubagentes();
    await plugin.event({event:{type:'session.created',properties:{info:{id:'ses_child',parentID:'ses_parent',title:'Auditor'}}}});
    await plugin.event({event:{type:'message.updated',properties:{info:{id:'msg_child',sessionID:'ses_child',role:'assistant',time:{completed:1},providerID:'openrouter',modelID:'proveedor/modelo',tokens:{input:12,output:4,reasoning:0,cache:{read:2}},cost:0}}}});`;
  const child = Bun.spawn([...prefijoAislamiento(cwd, true, [], perfil, nativo.directorio, nativo.rutaCaptura, undefined, undefined, undefined, red.directorio), process.execPath, "-e", programa], {
    cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...red.entorno }, stdout: "pipe", stderr: "pipe",
  });
  const [childCode, childErr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  assert.equal(childCode, 0, childErr);
  const eventos = readFileSync(nativo.rutaCaptura, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(eventos[1].kind, "usage"); assert.equal(eventos[1].tokens.input, 12);
  nativo.limpiar();
} finally {
  await red.cerrar(); host.closeAllConnections(); await new Promise<void>((r) => host.close(() => r()));
  assert(!existsSync(red.directorio)); rmSync(raiz, { recursive: true, force: true });
}
