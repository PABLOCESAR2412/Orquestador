import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Identifica cada build. La app lo compara con version.json para avisar de cambios.
const buildId = Date.now().toString(36);
let jsCargaInicial = new Set<string>();

// Workbox debe guardar la entrada y sus imports estáticos para abrir la PWA sin red. Los imports
// dinámicos (pantallas y, sobre todo, diagramas Mermaid/ELK) se guardan al usarse, no al instalar.
function detectarCargaInicial(): Plugin {
  return {
    name: "telo-pwa-carga-inicial",
    apply: "build",
    generateBundle(_opciones, bundle) {
      const chunks = Object.values(bundle).filter((salida) => salida.type === "chunk");
      const porArchivo = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const necesarios = new Set<string>();
      const visitar = (archivo: string) => {
        if (necesarios.has(archivo)) return;
        necesarios.add(archivo);
        for (const importado of porArchivo.get(archivo)?.imports ?? []) visitar(importado);
      };
      for (const chunk of chunks) if (chunk.isEntry) visitar(chunk.fileName);
      jsCargaInicial = necesarios;
    },
  };
}

// Escribe version.json junto al build.
function versionFile(): Plugin {
  return {
    name: "telo-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: buildId }) });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    versionFile(),
    detectarCargaInicial(),
    VitePWA({
      // "prompt": la versión nueva espera y la app pregunta antes de recargar.
      registerType: "prompt",
      // El service worker no debe responder las rutas de la API: la vuelta de Google y las descargas
      // llegan al servidor, no al index.html guardado en caché.
      workbox: {
        importScripts: ["/notification-events.js"],
        navigateFallbackDenylist: [/^\/api\//],
        // Los chunks que se cargan bajo demanda (vistas, Mermaid y ELK) pasan al caché al usarse.
        // Así siguen disponibles sin conexión después de abrirlos una vez, sin descargar todo al instalar.
        runtimeCaching: [{
          urlPattern: ({ url, request }) => url.pathname.startsWith("/assets/") && request.destination === "script",
          handler: "CacheFirst",
          options: {
            cacheName: "telo-chunks",
            expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [200] },
          },
        }],
        manifestTransforms: [(entries) => ({
          manifest: entries.filter(({ url }) => {
            const archivo = decodeURIComponent(url).replace(/^\/+/, "");
            if (/^assets\/.*\.js$/i.test(archivo)) return jsCargaInicial.has(archivo);
            if (/\.woff$/i.test(archivo)) return false;
            return !/-(cyrillic|greek|vietnamese)-[^/]*\.woff2$/i.test(archivo);
          }),
          warnings: [],
        })],
      },
      manifest: {
        name: "Telo",
        short_name: "Telo",
        description: "Telo, orquestador de agentes de IA",
        theme_color: "#111419",
        background_color: "#111419",
        display: "standalone",
        id: "/",
        scope: "/",
        start_url: "/chat",
        lang: "es",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    // Las fuentes van como archivos aparte: la CSP del servidor (font-src 'self') bloquea las incrustadas como data:.
    assetsInlineLimit: 0,
  },
});
