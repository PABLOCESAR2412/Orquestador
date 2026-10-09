export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? "./data",
  // Carpeta raíz de los proyectos del servidor. Sin ella, los proyectos quedan desactivados.
  projectsDir: process.env.TELO_PROYECTOS_DIR ?? null,
};
