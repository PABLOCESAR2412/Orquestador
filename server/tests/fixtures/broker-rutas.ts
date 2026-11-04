import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {request} from "node:http";
import {Readable,Writable} from "node:stream";
const raiz=mkdtempSync(join(tmpdir(),"telo-broker-rutas-"));
process.env.DATA_DIR=join(raiz,"data");process.env.HOME=join(raiz,"home");process.env.TELO_AISLAMIENTO="activado";
for (const nombre of ["OPENAI_API_KEY","GEMINI_API_KEY","GOOGLE_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY"]) delete process.env[nombre];
const auth=join(process.env.HOME,".local/share/opencode");mkdirSync(auth,{recursive:true});
writeFileSync(join(auth,"auth.json"),JSON.stringify({openai:{type:"oauth",access:"sesion-sintetica",refresh:"no-real"},google:{type:"oauth",access_token:"sesion-no-api",refresh:"no-real"}}));
mock.module("../../src/login-cli",()=>({sesionCodexConectada:async()=>true}));
mock.module("../../src/modelos-codex",()=>({listarModelosCodex:async()=>({models:[{id:"sesion",name:"Codex sesión",context:1000,variants:[]}]})}));
const {prepararRedAgente,proveedorCompatibleConBroker}=await import("../../src/runners/red-agente");
const {getModels}=await import("../../src/models");
const {db}=await import("../../src/db");
const spawn=Bun.spawn;
const which=Bun.which;
const catalogo=["opencode/gemini-prueba","deepseek/chat","xai/grok","google/gemini-api","openai/api","sin-broker/modelo"].map(id=>`${id}\n${JSON.stringify({name:"Modelo de prueba",cost:{input:1,output:1}})}\n`).join("");
Bun.which=((nombre:string,opciones?:{PATH?:string})=>nombre==="opencode"?"/tmp/opencode":which(nombre,opciones)) as typeof Bun.which;
Bun.spawn=((args:string[])=>{assert.equal(args[0],"opencode");return {stdout:new Blob([catalogo]).stream(),stderr:new Blob([]).stream(),exited:Promise.resolve(0),kill(){}};}) as any;
const vistas:any[]=[];
const transporte={resolver:async()=>"93.184.216.34",https:(opciones:any,callback:any)=>{
  let timeout:number|undefined;const chunks:Buffer[]=[];
  const p=new Writable({write(chunk,_e,cb){chunks.push(Buffer.from(chunk));cb();},final(cb){vistas.push({...opciones,timeout,body:Buffer.concat(chunks).toString()});const r=Readable.from(['{"ok":true}']) as any;r.statusCode=200;r.headers={"content-type":"application/json"};callback(r);cb();}}) as any;
  p.setTimeout=(ms:number)=>{timeout=ms;return p;};return p;
}};
async function llamada(red:{directorio:string},path:string,body:any){return new Promise<number>((resolve,reject)=>{const p=request({socketPath:join(red.directorio,"broker.sock"),path,method:"POST",headers:{"content-type":"application/json",authorization:"Bearer cliente-no-confiable",connection:"close"}},r=>{r.resume();r.on("end",()=>resolve(r.statusCode!));});p.on("error",reject);p.end(JSON.stringify(body));});}
try {
  const modelos=await getModels(true);const ids=modelos.map(m=>m.id);
  assert(ids.includes("deepseek/chat"));assert(ids.includes("xai/grok"));assert(ids.includes("codex/sesion"));
  assert(!ids.includes("sin-broker/modelo"));assert(!ids.includes("openai/api"));assert(!ids.includes("google/gemini-api"));
  const {entornoProveedores}=await import("../../src/claves-proveedor");assert.equal(entornoProveedores().GOOGLE_GENERATIVE_AI_API_KEY,undefined);
  assert.equal(proveedorCompatibleConBroker("openai"),false);
  process.env.OPENAI_API_KEY="clave-api-sintetica";
  assert((await getModels(true)).some(m=>m.id==="openai/api"));
  assert.equal(proveedorCompatibleConBroker("openai"),true);
  const casos=[
    {id:"opencode/gemini-prueba",variable:"OPENCODE_API_KEY",path:"/zen/v1/models/gemini-prueba:streamGenerateContent?alt=sse&key=cliente",google:true},
    {id:"google/gemini-prueba",variable:"GEMINI_API_KEY",path:"/v1beta/models/gemini-prueba:generateContent",google:true},
    {id:"deepseek/chat",variable:"DEEPSEEK_API_KEY",path:"/v1/chat/completions",google:false},
    {id:"xai/grok",variable:"XAI_API_KEY",path:"/v1/responses",google:false},
    {id:"cloudflare-workers-ai/@cf/meta/prueba",variable:"CLOUDFLARE_API_KEY",path:"/ai/v1/chat/completions",google:false},
  ];
  for(const caso of casos){
    const [proveedor,...partes]=caso.id.split("/");const nombre=partes.join("/");const clave="clave-inferencia-sintetica";
    const cuenta="a".repeat(32);
    const red=await prepararRedAgente({modelos:[caso.id],brokerOpenCode:true,extraEnv:{[caso.variable]:clave,CLOUDFLARE_ACCOUNT_ID:cuenta}},transporte as any);
    try {
      assert(!await Bun.file(join(red.directorio,"auth.json")).text().then(t=>t.includes(clave)));
      const path=`/telo-inference/${proveedor}${caso.path}`;
      assert.equal(await llamada(red,path,caso.google?{contents:[]}:{model:nombre,messages:[]}),200);
      const ultima=vistas.at(-1)!;assert.equal(ultima.timeout,0);assert(!ultima.path.includes("key=cliente"));
      if(proveedor==="cloudflare-workers-ai") {
        assert.equal(ultima.path,`/client/v4/accounts/${cuenta}/ai/v1/chat/completions`);
        assert(!JSON.stringify(red.configuracion).includes(cuenta));
        assert(!JSON.stringify(red.entorno).includes(cuenta));
      }
      assert.equal(ultima.headers[caso.google?"x-goog-api-key":"authorization"],caso.google?clave:`Bearer ${clave}`);
      const n=vistas.length;
      assert.equal(await llamada(red,caso.google?path.replace("gemini-prueba","modelo-ajeno"):path,caso.google?{contents:[]}:{model:"modelo-ajeno"}),403);
      assert.equal(vistas.length,n,"Una ruta no autorizada no debe llamar al proveedor");
    } finally {await red.cerrar();assert(!existsSync(red.directorio));}
  }
  let avisar!:()=>void;const iniciada=new Promise<void>(r=>{avisar=r;});let pendiente:any;
  const espera={resolver:transporte.resolver,https:()=>{pendiente=new Writable({autoDestroy:false,write(_c,_e,cb){cb();}}) as any;pendiente.setTimeout=(ms:number)=>{assert.equal(ms,0);return pendiente;};avisar();return pendiente;}};
  const red=await prepararRedAgente({modelos:["opencode/prueba"],brokerOpenCode:true},espera as any);
  try {
    const p=request({socketPath:join(red.directorio,"broker.sock"),path:"/telo-inference/opencode/zen/v1/chat/completions",method:"POST",headers:{"content-type":"application/json"}});p.on("error",()=>{});p.end('{"model":"prueba"}');
    await iniciada;assert(!pendiente.destroyed);p.destroy();await new Promise(r=>setTimeout(r,40));assert(pendiente.destroyed,"Cancelar el cliente debe cerrar la inferencia pendiente");
  } finally {await red.cerrar();}
} finally {Bun.spawn=spawn;Bun.which=which;db.close();rmSync(raiz,{recursive:true,force:true});}
