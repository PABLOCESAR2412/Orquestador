export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? "./data",
  // Carpeta raíz de los proyectos del servidor. Sin ella, los proyectos quedan desactivados.
  projectsDir: process.env.TELO_PROYECTOS_DIR ?? null,
  // Clave de acceso a la app (archivo de entorno de systemd, nunca en el repo).
  clave: process.env.TELO_CLAVE?.trim() || null,
  // Solo para desarrollo local: deja la API abierta. En el VM no se usa.
  sinClave: process.env.TELO_SIN_CLAVE === "1",
};
