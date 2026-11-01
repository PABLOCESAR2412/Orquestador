import { expect, test } from "bun:test";
import { comandoConRtk } from "../src/rtk";
import { pluginSeguimientoOpenCode } from "../src/runners/seguimiento-opencode";

test("RTK filtra comandos simples y conserva formatos, composición y escrituras", () => {
  expect(comandoConRtk("git status", "/usr/bin/rtk")).toBe("'/usr/bin/rtk' git status");
  expect(comandoConRtk("bun test tests/a.test.ts", "/usr/bin/rtk")).toContain("rtk' bun test");
  for (const comando of ["git status --porcelain", "git log --format=%H", "rg --json error", "git diff --exit-code", "git diff --output salida.txt", "git status | cat", "git status && git push", "cat secreto", "git push", "ls > lista", "rg $(echo x)", "rtk git status"]) {
    expect(comandoConRtk(comando, "/usr/bin/rtk")).toBe(comando);
  }
  expect(comandoConRtk("bun test", null)).toBe("bun test");
});

test("el plugin envuelve la herramienta real sin alterar las demás ni los permisos", async () => {
  const fuente = pluginSeguimientoOpenCode("/tmp/no-utilizado", "ses_prueba", "/usr/bin/rtk");
  const { TeloSeguimiento } = await import(`data:text/javascript;base64,${Buffer.from(fuente).toString("base64")}`);
  const hooks = await TeloSeguimiento();
  const output = { args: { command: "git status", description: "Revisar" } };
  await hooks["tool.execute.before"]({ tool: "bash" }, output);
  expect(output.args.command).toBe("'/usr/bin/rtk' git status");
  expect(output.args.description).toBe("Revisar");
  const otro = { args: { command: "git status" } };
  await hooks["tool.execute.before"]({ tool: "read" }, otro);
  expect(otro.args.command).toBe("git status");
});
