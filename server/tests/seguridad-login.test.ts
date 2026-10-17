import { describe, expect, test } from "bun:test";
import { bloquearIntento, LimitadorLogin, resolverIpCliente, validarIp } from "../src/seguridad-login";

describe("protección del inicio de sesión", () => {
  test("valida IPv4 e IPv6 con el parser de red del sistema", () => {
    expect(validarIp("192.0.2.1")).toBe("192.0.2.1");
    expect(validarIp("2001:db8::1")).toBe("2001:db8::1");
    expect(validarIp("999.999.999.999")).toBeNull();
    expect(validarIp("::::")).toBeNull();
    expect(validarIp(undefined)).toBeNull();
  });

  test("ignora cabeceras IP falsificadas salvo que el peer sea un proxy de confianza", () => {
    const cabeceras = {
      cfConnectingIp: "198.51.100.90",
      forwardedFor: "203.0.113.8, 198.51.100.91",
      realIp: "203.0.113.9",
    };
    expect(resolverIpCliente("192.0.2.10", cabeceras, new Set())).toBe("192.0.2.10");
    expect(resolverIpCliente("192.0.2.10", cabeceras, new Set(["192.0.2.10"]))).toBe("198.51.100.90");
    expect(resolverIpCliente("192.0.2.10", { forwardedFor: "inválida, 203.0.113.8" }, new Set(["192.0.2.10"])))
      .toBe("203.0.113.8");
    expect(resolverIpCliente(undefined, cabeceras, new Set(["192.0.2.10"]))).toBe("desconocida");
  });

  test("el límite distribuido bloquea claves incorrectas, pero deja entrar al dueño con la clave correcta", () => {
    const limitador = new LimitadorLogin(900_000, 10, 50);
    for (let i = 1; i <= 50; i++) {
      const ip = `198.51.100.${i}`;
      const limites = limitador.limites(ip, 1_000);
      expect(bloquearIntento(limites, false)).toBe(false);
      limitador.registrarFallo(ip, 1_000);
    }

    const limites = limitador.limites("198.51.100.100", 1_001);
    expect(limites.global).toBe(true);
    expect(bloquearIntento(limites, false)).toBe(true);
    expect(bloquearIntento(limites, true)).toBe(false);
  });

  test("el límite por IP expira con su ventana y éxito borra los intentos de esa IP", () => {
    const limitador = new LimitadorLogin(1_000, 2, 50);
    limitador.registrarFallo("192.0.2.4", 100);
    limitador.registrarFallo("192.0.2.4", 200);
    expect(limitador.limites("192.0.2.4", 300).ip).toBe(true);
    limitador.limpiar("192.0.2.4");
    expect(limitador.limites("192.0.2.4", 300).ip).toBe(false);
    expect(limitador.limites("192.0.2.4", 1_201).global).toBe(false);
  });
});
