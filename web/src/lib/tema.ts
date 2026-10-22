// Preferencias visuales por dispositivo. Nada se envía al servidor.
export type ModoTema = "oscuro" | "claro";

type DefTema = {
  id: string;
  nombre: string;
  modo: ModoTema;
  bg: string;
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  accent: string;
  accentFg: string;
  line: string;
};

const tema = (
  id: string, nombre: string, modo: ModoTema, bg: string, surface: string,
  raised: string, ink: string, muted: string, accent: string, accentFg: string, line: string,
): DefTema => ({ id, nombre, modo, bg, surface, raised, ink, muted, accent, accentFg, line });

export const TEMAS = [
  tema("telo-obsidiana", "Telo Obsidiana", "oscuro", "#0e0f12", "#121316", "#1b1b1f", "#f5f5f7", "#9ca3af", "#f5f5f7", "#0e0f12", "#292a2d"),
  tema("telo-claro", "Telo Claro", "claro", "#f9fafb", "#ffffff", "#f3f4f5", "#111827", "#4b5563", "#111827", "#ffffff", "#e5e7eb"),
  tema("github-dark", "GitHub Dark", "oscuro", "#0d1117", "#161b22", "#21262d", "#e6edf3", "#8b949e", "#2f81f7", "#ffffff", "#30363d"),
  tema("github-light", "GitHub Light", "claro", "#ffffff", "#f6f8fa", "#eaeef2", "#1f2328", "#59636e", "#0969da", "#ffffff", "#d1d9e0"),
  tema("everforest-dark", "Everforest Dark", "oscuro", "#2d353b", "#343f44", "#3d484d", "#d3c6aa", "#9da9a0", "#a7c080", "#2d353b", "#4a555b"),
  tema("everforest-light", "Everforest Light", "claro", "#fdf6e3", "#f4f0d9", "#e9e4cc", "#5c6a72", "#829181", "#8da101", "#ffffff", "#e0dcc7"),
  tema("notion-light", "Notion Light", "claro", "#ffffff", "#f7f6f3", "#efeee9", "#37352f", "#787774", "#2f3437", "#ffffff", "#e8e7e4"),
  tema("notion-dark", "Notion Dark", "oscuro", "#191919", "#202020", "#2f2f2f", "#ebebeb", "#a3a3a3", "#529cca", "#111111", "#383838"),
  tema("monokai", "Monokai", "oscuro", "#272822", "#2d2e27", "#3a3b32", "#f8f8f2", "#a6a69c", "#a6e22e", "#272822", "#494a40"),
  tema("dracula", "Dracula", "oscuro", "#282a36", "#343746", "#44475a", "#f8f8f2", "#a6a7b5", "#bd93f9", "#282a36", "#4b4d5d"),
  tema("nord", "Nord", "oscuro", "#2e3440", "#3b4252", "#434c5e", "#eceff4", "#a5adbd", "#88c0d0", "#2e3440", "#4c566a"),
  tema("tokyo-night", "Tokyo Night", "oscuro", "#1a1b26", "#1f2335", "#292e42", "#c0caf5", "#8b92b9", "#7aa2f7", "#1a1b26", "#343a55"),
  tema("catppuccin-mocha", "Catppuccin Mocha", "oscuro", "#1e1e2e", "#242438", "#313244", "#cdd6f4", "#a6adc8", "#cba6f7", "#1e1e2e", "#45475a"),
  tema("catppuccin-latte", "Catppuccin Latte", "claro", "#eff1f5", "#ffffff", "#e6e9ef", "#4c4f69", "#6c6f85", "#8839ef", "#ffffff", "#ccd0da"),
  tema("solarized-dark", "Solarized Dark", "oscuro", "#002b36", "#073642", "#0b4655", "#eee8d5", "#93a1a1", "#2aa198", "#002b36", "#31545b"),
  tema("solarized-light", "Solarized Light", "claro", "#fdf6e3", "#eee8d5", "#e3dcc5", "#586e75", "#81908e", "#268bd2", "#ffffff", "#d7d0bd"),
  tema("one-dark", "One Dark", "oscuro", "#282c34", "#2c313a", "#353b45", "#abb2bf", "#858d9b", "#61afef", "#20242b", "#454b56"),
  tema("rose-pine", "Rosé Pine", "oscuro", "#191724", "#1f1d2e", "#26233a", "#e0def4", "#908caa", "#c4a7e7", "#191724", "#403d52"),
  tema("gruvbox-dark", "Gruvbox Dark", "oscuro", "#282828", "#32302f", "#3c3836", "#ebdbb2", "#a89984", "#fabd2f", "#282828", "#504945"),
  tema("alto-contraste", "Alto contraste", "oscuro", "#000000", "#080808", "#171717", "#ffffff", "#c7c7c7", "#00e5ff", "#000000", "#737373"),
] as const satisfies readonly DefTema[];

export type TemaId = (typeof TEMAS)[number]["id"];
// Los tres valores antiguos siguen aceptándose para los comandos guardados y el botón rápido.
export type Tema = "sistema" | "oscuro" | "claro" | TemaId;

export const TIPOGRAFIAS = [
  { id: "geist", nombre: "Geist", stack: '"Geist", system-ui, sans-serif' },
  { id: "instrument", nombre: "Instrument Sans", stack: '"Instrument Sans", system-ui, sans-serif' },
  { id: "segoe", nombre: "Segoe UI", stack: '"Segoe UI", system-ui, sans-serif' },
  { id: "arial", nombre: "Arial", stack: 'Arial, Helvetica, sans-serif' },
  { id: "verdana", nombre: "Verdana", stack: 'Verdana, Geneva, sans-serif' },
  { id: "tahoma", nombre: "Tahoma", stack: 'Tahoma, Geneva, sans-serif' },
  { id: "trebuchet", nombre: "Trebuchet MS", stack: '"Trebuchet MS", sans-serif' },
  { id: "georgia", nombre: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  { id: "times", nombre: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { id: "jetbrains", nombre: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace' },
] as const;

export type TipografiaId = (typeof TIPOGRAFIAS)[number]["id"];

const CLAVE_TEMA = "telo:tema";
const CLAVE_TIPOGRAFIA = "telo:tipografia";
const CLAVE_ESCALA = "telo:escala-texto";
const VALORES_TEMA = new Set<string>(["sistema", "oscuro", "claro", ...TEMAS.map((t) => t.id)]);
const VALORES_TIPOGRAFIA = new Set<string>(TIPOGRAFIAS.map((t) => t.id));
const TOKEN_COLOR = [
  "--bg", "--surface", "--surface-2", "--surface-lowest", "--surface-hover", "--line", "--line-strong",
  "--ink", "--ink-2", "--ink-3", "--tertiary", "--online", "--file-link", "--online-bg", "--danger",
  "--danger-soft", "--danger-line", "--primary", "--primary-fg", "--bar", "--signal", "--signal-soft",
  "--signal-line", "--scrim", "--shadow",
];

function leerValor(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}

function guardarValor(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* El ajuste dura hasta recargar. */ }
}

export function leerTema(): Tema {
  const valor = leerValor(CLAVE_TEMA);
  if (!valor || !VALORES_TEMA.has(valor)) return "telo-obsidiana";
  if (valor === "oscuro") return "telo-obsidiana";
  if (valor === "claro") return "telo-claro";
  return valor as Tema;
}

export function leerTipografia(): TipografiaId {
  const valor = leerValor(CLAVE_TIPOGRAFIA);
  return valor && VALORES_TIPOGRAFIA.has(valor) ? valor as TipografiaId : "geist";
}

export function leerEscalaTexto(): number {
  const valor = Number(leerValor(CLAVE_ESCALA) ?? 100);
  return Number.isFinite(valor) && valor >= 90 && valor <= 125 && valor % 5 === 0 ? valor : 100;
}

function colorConAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const rgb = hex.length === 3
    ? hex.split("").map((c) => Number.parseInt(c + c, 16))
    : [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function limpiarColores(el: HTMLElement) {
  for (const token of TOKEN_COLOR) el.style.removeProperty(token);
}

export function aplicarTema(valor: Tema = leerTema()) {
  const el = document.documentElement;
  const id = valor === "oscuro" ? "telo-obsidiana" : valor === "claro" ? "telo-claro" : valor;
  if (id === "sistema") {
    el.removeAttribute("data-theme");
    el.removeAttribute("data-palette");
    limpiarColores(el);
    return;
  }
  const paleta = TEMAS.find((t) => t.id === id);
  if (!paleta) return;
  el.dataset.theme = paleta.modo;
  el.dataset.palette = paleta.id;
  const oscuro = paleta.modo === "oscuro";
  const set = (nombre: string, color: string) => el.style.setProperty(nombre, color);
  set("--bg", paleta.bg);
  set("--surface", paleta.surface);
  set("--surface-2", paleta.raised);
  set("--surface-lowest", oscuro ? paleta.bg : paleta.surface);
  set("--surface-hover", paleta.raised);
  set("--line", paleta.line);
  set("--line-strong", colorConAlpha(paleta.ink, oscuro ? 0.28 : 0.22));
  set("--ink", paleta.ink);
  set("--ink-2", paleta.muted);
  set("--ink-3", colorConAlpha(paleta.muted, 0.68));
  set("--tertiary", paleta.muted);
  set("--online", oscuro ? "#4ade80" : "#15803d");
  set("--file-link", oscuro ? "#4ade80" : "#15803d");
  set("--online-bg", colorConAlpha(oscuro ? "#4ade80" : "#15803d", oscuro ? 0.16 : 0.1));
  set("--danger", oscuro ? "#f07167" : "#c9352b");
  set("--danger-soft", colorConAlpha(oscuro ? "#f07167" : "#c9352b", 0.12));
  set("--danger-line", colorConAlpha(oscuro ? "#f07167" : "#c9352b", 0.32));
  set("--primary", paleta.accent);
  set("--primary-fg", paleta.accentFg);
  set("--bar", paleta.muted);
  set("--signal", paleta.accent);
  set("--signal-soft", colorConAlpha(paleta.accent, 0.1));
  set("--signal-line", colorConAlpha(paleta.accent, 0.4));
  set("--scrim", colorConAlpha(paleta.bg, 0.82));
  set("--shadow", "rgba(0, 0, 0, 0.34)");
}

export function guardarTema(valor: Tema) {
  const anterior = leerTema();
  if (anterior !== "sistema") guardarValor(`telo:paleta-${temaEsClaro(anterior) ? "claro" : "oscuro"}`, anterior);
  const canonico: Tema = valor === "oscuro" ? "telo-obsidiana" : valor === "claro" ? "telo-claro" : valor;
  guardarValor(CLAVE_TEMA, canonico);
  if (canonico !== "sistema") guardarValor(`telo:paleta-${temaEsClaro(canonico) ? "claro" : "oscuro"}`, canonico);
  aplicarTema(canonico);
  window.dispatchEvent(new Event("telo:tema-cambiado"));
}

export function guardarTipografia(id: TipografiaId) {
  const elegida = TIPOGRAFIAS.find((f) => f.id === id);
  if (!elegida) return;
  guardarValor(CLAVE_TIPOGRAFIA, id);
  document.documentElement.style.setProperty("--font", elegida.stack);
}

export function guardarEscalaTexto(valor: number) {
  const escala = Math.max(90, Math.min(125, Math.round(valor / 5) * 5));
  guardarValor(CLAVE_ESCALA, String(escala));
  document.documentElement.style.setProperty("--telo-escala", String(escala / 100));
}

// Aplica las preferencias antes del primer render para evitar destellos con la apariencia anterior.
export function aplicarApariencia() {
  aplicarTema();
  const fuente = TIPOGRAFIAS.find((f) => f.id === leerTipografia()) ?? TIPOGRAFIAS[0];
  document.documentElement.style.setProperty("--font", fuente.stack);
  document.documentElement.style.setProperty("--telo-escala", String(leerEscalaTexto() / 100));
}

export function temaEsClaro(valor: Tema): boolean {
  if (valor === "sistema") return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  if (valor === "claro") return true;
  if (valor === "oscuro") return false;
  return TEMAS.find((t) => t.id === valor)?.modo === "claro";
}

export function temaComplementario(valor: Tema): Tema {
  const esClaro = temaEsClaro(valor);
  // Conserva también paletas sin pareja (Dracula, Monokai, etc.) al volver del otro modo.
  const recordado = leerValor(`telo:paleta-${esClaro ? "oscuro" : "claro"}`);
  if (recordado && TEMAS.some((t) => t.id === recordado && t.modo === (esClaro ? "oscuro" : "claro"))) return recordado as Tema;
  const pareja: Partial<Record<TemaId, TemaId>> = {
    "telo-obsidiana": "telo-claro", "telo-claro": "telo-obsidiana",
    "github-dark": "github-light", "github-light": "github-dark",
    "everforest-dark": "everforest-light", "everforest-light": "everforest-dark",
    "notion-light": "notion-dark", "notion-dark": "notion-light",
    "catppuccin-mocha": "catppuccin-latte", "catppuccin-latte": "catppuccin-mocha",
    "solarized-dark": "solarized-light", "solarized-light": "solarized-dark",
  };
  const complemento = pareja[valor as TemaId];
  if (complemento) return complemento;
  return esClaro ? "telo-obsidiana" : "telo-claro";
}
