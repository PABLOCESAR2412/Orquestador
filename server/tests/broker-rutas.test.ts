import {expect,test} from "bun:test";
import {join} from "node:path";

test.skipIf(process.platform !== "linux")("el catálogo y el broker aceptan solo rutas y autenticación compatibles", async () => {
  const p = Bun.spawn([process.execPath, join(import.meta.dir,"fixtures/broker-rutas.ts")], {stdout:"pipe",stderr:"pipe"});
  const [codigo,salida,error] = await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);
  expect({codigo,error:codigo ? salida+error : ""}).toEqual({codigo:0,error:""});
},15_000);
