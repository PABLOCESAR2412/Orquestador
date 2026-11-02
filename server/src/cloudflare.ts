// El identificador de cuenta solo puede ocupar un segmento fijo del endpoint oficial.
export function cuentaCloudflareValida(valor: unknown): valor is string {
  return typeof valor === "string" && /^[a-f0-9]{32}$/i.test(valor);
}

export function endpointCloudflare(cuenta: unknown): string | null {
  return cuentaCloudflareValida(cuenta)
    ? `https://api.cloudflare.com/client/v4/accounts/${cuenta.toLowerCase()}/ai/v1`
    : null;
}
