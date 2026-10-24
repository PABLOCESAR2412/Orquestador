import { expect, test } from "bun:test";
import { ApiError, api } from "../src/api";

// El cliente atraviesa la ventana del reinicio del servicio: los GET reintentan ante
// 502/503/504 y ante una conexión caída; las mutaciones y los códigos definitivos fallan
// en el primer intento para no duplicar un envío ni ocultar un error real.
test("un GET atraviesa dos 502 consecutivos y responde con el tercer intento", async () => {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    if (llamadas <= 2) return new Response(null, { status: 502 });
    return Response.json({ ok: true, time: "ahora" });
  }) as typeof fetch;
  try {
    expect(await api.health()).toEqual({ ok: true, time: "ahora" });
    expect(llamadas).toBe(3);
  } finally {
    globalThis.fetch = original;
  }
});

test("un POST con 502 falla de una vez, sin reintentar", async () => {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    return new Response(JSON.stringify({ error: "gateway" }), { status: 502 });
  }) as typeof fetch;
  try {
    await expect(api.login("cualquiera")).rejects.toMatchObject({ status: 502, code: "gateway" });
    expect(llamadas).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test("un GET con 500 falla sin reintentar: solo los transitorios se reintentan", async () => {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    return new Response(JSON.stringify({ error: "interno" }), { status: 500 });
  }) as typeof fetch;
  try {
    await expect(api.health()).rejects.toMatchObject({ status: 500, code: "interno" });
    expect(llamadas).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test("una conexión caída con GET reintenta dos veces y al final se ve el error de red", async () => {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    await expect(api.health()).rejects.toBeInstanceOf(TypeError);
    expect(llamadas).toBe(3);
  } finally {
    globalThis.fetch = original;
  }
});
