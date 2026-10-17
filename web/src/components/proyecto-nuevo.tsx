import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Project, type ProjectSshKey } from "../api";
import { errorText } from "../lib/model";
import { MAX_NOMBRE_PROYECTO, carpetaDe, rutaCarpeta } from "../lib/proyecto";
import { useDialogo } from "./controls";
import { copiarTexto } from "./chat-contenido";

// Ventana «Nuevo proyecto». Sin repo, se crea el proyecto y se abre su configuración.
// Con un repo de GitHub, Telo lo revisa antes de crear nada: si es público, clona en el chat del proyecto;
// si es privado y la GitHub App tiene acceso, la usa; si no, ofrece la clave SSH como alternativa.
export function NuevoProyectoDialog({ onCerrar }: { onCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogo(ref, onCerrar);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [nombre, setNombre] = useState("");
  const [conClonar, setConClonar] = useState(false);
  const [url, setUrl] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [progreso, setProgreso] = useState("Creando…");
  const [error, setError] = useState<unknown>(null);
  // Segundo paso: el proyecto ya existe y falta darle la clave a GitHub o reintentar el clonado.
  const [paso2, setPaso2] = useState(false);
  const [creado, setCreado] = useState<Project | null>(null);
  const [clave, setClave] = useState<ProjectSshKey | null>(null);
  const [copia, setCopia] = useState<"reposo" | "copiada" | "fallo">("reposo");

  const slug = carpetaDe(nombre.trim());
  const vistaPrevia = !nombre.trim()
    ? "Escribe un nombre para ver la carpeta que se creará."
    : slug
      ? `Carpeta: ${rutaCarpeta(slug)}`
      : "El nombre necesita al menos una letra o un número para crear la carpeta.";

  // Cierra la ventana y abre la configuración del proyecto. Con `clonandoEn`, el avance está en ese chat.
  const irAlProyecto = (p: Project, clonandoEn?: string) => {
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
    onCerrar();
    void navigate({
      to: "/proyectos/$id",
      params: { id: p.id },
      state: (prev) => ({ ...prev, proyectoNuevo: true, clonandoEn }),
    });
  };

  const vincularExistente = async () => {
    const n = nombre.trim();
    if (!n || !slug || ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      setProgreso("Vinculando carpeta existente…");
      irAlProyecto(await api.createProject({ path: slug, name: n }));
    } catch (err) {
      setError(err);
    } finally {
      setOcupado(false);
    }
  };

  const sobrescribirYCrear = async () => {
    const n = nombre.trim();
    if (!n || !slug || ocupado) return;
    setOcupado(true);
    setError(null);
    let nuevo: Project | null = null;
    try {
      if (!conClonar) {
        setProgreso("Vaciando y creando el proyecto…");
        irAlProyecto(await api.createProject({ name: n, sobrescribir: true }));
        return;
      }
      setProgreso("Revisando el repositorio…");
      const revision = await api.verificarRepositorioGithub(url.trim());
      setProgreso("Recreando el proyecto…");
      nuevo = await api.createProject({ name: n, url: revision.url, sobrescribir: true });
      setCreado(nuevo);
      if (revision.visibilidad === "publico" || revision.credencial === "app") {
        setProgreso(revision.credencial === "app" ? "Clonando con la GitHub App…" : "Empezando el clonado…");
        const inicio = await api.cloneProject(nuevo.id);
        irAlProyecto(nuevo, inicio.conversacion_id);
        return;
      }
      setProgreso("Creando la clave de GitHub…");
      setClave(await api.createProjectSshKey(nuevo.id));
      setPaso2(true);
    } catch (err) {
      setError(err);
      if (nuevo) setPaso2(true);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const n = nombre.trim();
    if (!n || !slug || ocupado) return;
    setOcupado(true);
    setError(null);
    let nuevo: Project | null = null;
    try {
      if (!conClonar) {
        setProgreso("Creando el proyecto…");
        irAlProyecto(await api.createProject({ name: n }));
        return;
      }

      setProgreso("Revisando el repositorio…");
      const revision = await api.verificarRepositorioGithub(url.trim());
      setProgreso("Creando el proyecto…");
      nuevo = await api.createProject({ name: n, url: revision.url });
      setCreado(nuevo);

      if (revision.visibilidad === "publico" || revision.credencial === "app") {
        setProgreso(revision.credencial === "app" ? "Clonando con la GitHub App…" : "Empezando el clonado…");
        const inicio = await api.cloneProject(nuevo.id);
        irAlProyecto(nuevo, inicio.conversacion_id);
        return;
      }

      // Privado: la clave se crea ya para mostrarla aquí mismo.
      setProgreso("Creando la clave de GitHub…");
      setClave(await api.createProjectSshKey(nuevo.id));
      setPaso2(true);
    } catch (err) {
      setError(err);
      if (nuevo) setPaso2(true);
    } finally {
      setOcupado(false);
    }
  };

  // Clonar desde el segundo paso (privado, con la clave ya agregada en GitHub).
  const clonarAhora = async () => {
    if (!creado || ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const inicio = await api.cloneProject(creado.id);
      irAlProyecto(creado, inicio.conversacion_id);
    } catch (err) {
      setError(err);
    } finally {
      setOcupado(false);
    }
  };

  async function copiar() {
    if (!clave?.publica) return;
    setCopia((await copiarTexto(clave.publica)) ? "copiada" : "fallo");
  }

  return (
    <>
      <div className="scrim" onClick={onCerrar} />
      <div
        className="tl-dialogo proyecto-nuevo"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proyecto-nuevo-titulo"
        ref={ref}
      >
        <div className="tl-dialogo-cabecera">
          <h2 className="tl-dialogo-h2" id="proyecto-nuevo-titulo">
            {paso2 ? (clave ? "Agrega la clave a GitHub" : "El proyecto está creado") : "Nuevo proyecto"}
          </h2>
          <div className="tl-dialogo-acciones">
            <button type="button" className="tl-boton" onClick={onCerrar}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="tl-dialogo-cuerpo">
          {!paso2 && (
            <form className="proyecto-nuevo-form" onSubmit={enviar}>
              <label className="tl-campo">
                <span className="tl-campo-etiqueta">Nombre del proyecto</span>
                <input
                  className="tl-campo-texto"
                  autoFocus
                  maxLength={MAX_NOMBRE_PROYECTO}
                  placeholder="Ej. orquestador-core"
                  autoComplete="off"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  aria-describedby="proyecto-nuevo-carpeta"
                />
                <span id="proyecto-nuevo-carpeta" className="tl-campo-ayuda" aria-live="polite">
                  {vistaPrevia}
                </span>
              </label>

              <label className="proyecto-opcion">
                <input
                  type="checkbox"
                  checked={conClonar}
                  onChange={(e) => {
                    setConClonar(e.target.checked);
                    setError(null);
                  }}
                />
                <span>Clonar un repositorio de GitHub (opcional)</span>
              </label>

              {conClonar && (
                <label className="tl-campo">
                  <span className="tl-campo-etiqueta">Dirección del repositorio</span>
                  <input
                    className="tl-campo-texto"
                    placeholder="https://github.com/dueño/repo"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-describedby="proyecto-nuevo-github"
                  />
                  <span id="proyecto-nuevo-github" className="tl-campo-ayuda">
                    Telo usa la GitHub App vinculada para clonar repositorios privados a los que tenga acceso. Si no puede usarla, te ofrecerá una clave SSH.
                  </span>
                </label>
              )}

              {error != null && (
                <div className="error-box" role="alert">
                  <span className="error-text">{errorText(error)}</span>
                  {error instanceof ApiError && error.code === "project_folder_exists" && (
                    <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem" }}
                        onClick={() => void vincularExistente()}
                        disabled={ocupado}
                      >
                        Vincular carpeta existente
                      </button>
                      <button
                        type="button"
                        className="btn-ghost is-peligro"
                        style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem" }}
                        onClick={() => void sobrescribirYCrear()}
                        disabled={ocupado}
                      >
                        Vaciar y empezar de cero
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="proyecto-nuevo-acciones">
                <button type="button" className="btn-ghost" onClick={onCerrar}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!nombre.trim() || !slug || (conClonar && !url.trim()) || ocupado}
                >
                  {ocupado ? progreso : conClonar ? "Revisar y crear" : "Crear proyecto"}
                </button>
              </div>
            </form>
          )}

          {paso2 && creado && (
            <div className="proyecto-nuevo-form">
              {clave ? (
                <>
                  <p className="help-note">
                    <strong>{creado.name}</strong> es un repositorio privado. Telo necesita una clave de solo lectura para
                    clonarlo. Agrégala así:
                  </p>
                  <ol className="clonar-pasos">
                    <li>Copia la clave de abajo.</li>
                    <li>En GitHub, abre el repositorio y ve a Settings → Deploy keys → Add deploy key.</li>
                    <li>Ponle un título, por ejemplo Telo, pega la clave y deja sin marcar la escritura.</li>
                    <li>Vuelve aquí y pulsa Clonar ahora.</li>
                  </ol>
                  <pre className="mono-block" aria-label="Clave pública de GitHub">
                    {clave.publica}
                  </pre>
                  <div>
                    <button type="button" className="btn-ghost" onClick={() => void copiar()}>
                      {copia === "copiada" ? "Clave copiada" : "Copiar clave"}
                    </button>
                    {copia === "fallo" && (
                      <p className="error" role="alert">
                        No se pudo copiar. Selecciona la clave y cópiala a mano.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="help-note">
                  Todavía no se clonó. Puedes intentarlo otra vez desde la configuración del proyecto.
                </p>
              )}

              {error != null && (
                <div className="error-box" role="alert">
                  <span className="error-text">{errorText(error)}</span>
                </div>
              )}

              <div className="proyecto-nuevo-acciones">
                {clave ? (
                  <>
                    <button type="button" className="btn-ghost" disabled={ocupado} onClick={() => irAlProyecto(creado)}>
                      Después
                    </button>
                    <button type="button" className="btn-primary" disabled={ocupado} onClick={() => void clonarAhora()}>
                      {ocupado ? "Empezando el clonado…" : "Clonar ahora"}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => irAlProyecto(creado)}>
                    Abrir el proyecto
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
