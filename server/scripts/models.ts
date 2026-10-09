const txt = await Bun.stdin.text();
const parts = txt.split(/^(\S+\/\S+)$/m).slice(1);
const rows: Record<string, string | number>[] = [];

for (let i = 0; i < parts.length; i += 2) {
  try {
    const data = JSON.parse(parts[i + 1]);
    rows.push({
      modelo: parts[i],
      entrada_usd: data.cost?.input ?? "?",
      salida_usd: data.cost?.output ?? "?",
      contexto: data.limit?.context ?? "?",
      variantes: Object.keys(data.variants ?? {}).join(", ") || "ninguna",
    });
  } catch {
    // bloque no válido: se omite
  }
}

console.table(rows);
