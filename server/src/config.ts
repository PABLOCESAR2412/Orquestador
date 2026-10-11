export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Solo escucha en local por defecto. Tailscale Serve entrega el tráfico desde este mismo equipo.
  // TELO_ESCUCHAR=0.0.0.0 solo si de verdad se necesita otra interfaz.
  hostname: process.env.TELO_ESCUCHAR?.trim() || "127.0.0.1",
  dataDir: process.env.DATA_DIR ?? "./data",
  // Carpeta raíz de los proyectos del servidor. Sin ella, los proyectos quedan desactivados.
  projectsDir: process.env.TELO_PROYECTOS_DIR ?? null,
  // Clave de acceso a la app (archivo de entorno de systemd, nunca en el repo).
  clave: process.env.TELO_CLAVE?.trim() || null,
  // Clave de 32 bytes en base64 para cifrar los secretos de proyecto (AES-256-GCM).
  // Sin ella, los secretos no se pueden guardar. Va en el archivo de entorno del VM.
  claveCifrado: process.env.TELO_CLAVE_CIFRADO?.trim() || null,
  // Solo para desarrollo local: deja la API abierta. En el VM no se usa.
  sinClave: process.env.TELO_SIN_CLAVE === "1",
  // Dirección pública por la que se entra a Telo (https://…). Google vuelve a <dirección>/api/google/callback,
  // así que debe ser exactamente la que se registra en Google Cloud. Se lee en cada uso (sin caché).
  get publicUrl() {
    return process.env.TELO_PUBLIC_URL?.trim() || null;
  },
  // Cliente OAuth web de Google Cloud. El secreto va en el archivo de entorno del VM, nunca en el repo.
  get googleClientId() {
    return process.env.TELO_GOOGLE_CLIENT_ID?.trim() || null;
  },
  get googleClientSecret() {
    return process.env.TELO_GOOGLE_CLIENT_SECRET?.trim() || null;
  },
};
