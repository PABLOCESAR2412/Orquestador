import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type GitConfig, type RepositoryAction } from "../api";
import { errorText } from "../lib/model";
import { RepositoryApproval } from "./repository-approval";
import "../styles-flujo.css";

export function ProyectoConfiguracion({ id }: { id: string }) {
  return (
    <>
      <ProyectoGit id={id} />
      <ImportarSkills id={id} />
      <ContextoProyecto id={id} />
    </>
  );
}
function ProyectoGit({ id }: { id: string }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["project-git", id], queryFn: () => api.projectGit(id) });
  const [edicion, setEdicion] = useState<Pick<
    GitConfig,
    "remote" | "author_name" | "author_email" | "base_branch"
  > | null>(null);
  const [accion, setAccion] = useState<RepositoryAction | null>(null);
  const guardar = useMutation({
    mutationFn: () => api.saveProjectGit(id, edicion!),
    onSuccess: () => {
      setEdicion(null);
      void qc.invalidateQueries({ queryKey: ["project-git", id] });
    },
  });
  const comprobar = useMutation({ mutationFn: () => api.checkProjectGit(id) });
  const iniciar = useMutation({
    mutationFn: () => api.requestRepositoryAction(id, { action: "init" }),
    onSuccess: setAccion,
  });
  const [token, setToken] = useState("");
  const guardarToken = useMutation({
    mutationFn: () => api.setProjectSecret(id, "GITHUB_TOKEN", token),
    onSuccess: () => {
      setToken("");
      void qc.invalidateQueries({ queryKey: ["project-git", id] });
      void qc.invalidateQueries({ queryKey: ["project-secrets", id] });
    },
  });
  const data = edicion ?? cfg.data;
  const cambiar = (
    campo: "remote" | "author_name" | "author_email" | "base_branch",
    valor: string,
  ) => {
    if (data)
      setEdicion({
        remote: data.remote ?? "",
        author_name: data.author_name,
        author_email: data.author_email,
        base_branch: data.base_branch,
        [campo]: valor,
      });
  };
  return (
    <section className="panel approval-panel" aria-label="Git y GitHub">
      <h2>Git y GitHub</h2>
      <p className="hint">
        La identidad firma tus commits. El token o la clave SSH autorizan el acceso al repositorio;
        clonar un repositorio público no concede permiso para subir cambios.
      </p>
      {cfg.isPending && <p>Cargando configuración…</p>}
      {cfg.isError && <p className="error">{errorText(cfg.error)}</p>}
      {data && (
        <form
          className="project-config-form"
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate();
          }}
        >
          <label>
            Repositorio en GitHub
            <input
              type="url"
              placeholder="https://github.com/usuario/repositorio"
              value={data.remote ?? ""}
              onChange={(e) => cambiar("remote", e.target.value)}
            />
          </label>
          <label>
            Nombre para commits
            <input
              value={data.author_name}
              maxLength={100}
              onChange={(e) => cambiar("author_name", e.target.value)}
              required
            />
          </label>
          <label>
            Correo para commits
            <input
              type="email"
              value={data.author_email}
              maxLength={200}
              onChange={(e) => cambiar("author_email", e.target.value)}
              required
            />
          </label>
          <label>
            Rama destino de los PR
            <input
              value={data.base_branch}
              onChange={(e) => cambiar("base_branch", e.target.value)}
              required
            />
          </label>
          <div className="approval-buttons">
            <button type="submit" className="primary" disabled={!edicion || guardar.isPending}>
              Guardar configuración
            </button>
            <button
              type="button"
              className="ghost"
              disabled={comprobar.isPending || !!edicion}
              onClick={() => comprobar.mutate()}
            >
              Comprobar acceso con token
            </button>
            <button
              type="button"
              className="ghost"
              disabled={iniciar.isPending || cfg.data?.ocupado}
              onClick={() => iniciar.mutate()}
            >
              Inicializar Git…
            </button>
          </div>
        </form>
      )}
      <p>
        {cfg.data?.token
          ? "Token del proyecto configurado."
          : cfg.data?.ssh
            ? "Clave SSH del proyecto configurada."
            : "No hay credenciales para subir cambios."}
      </p>
      <form
        className="project-config-form"
        onSubmit={(e) => {
          e.preventDefault();
          guardarToken.mutate();
        }}
      >
        <label>
          Token de GitHub para este proyecto
          <input
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Se guarda cifrado; no se entrega al agente"
          />
        </label>
        <p className="hint">
          Usa un token limitado a este repositorio: Contents de escritura para push y Pull requests
          de escritura para crear PR. Puedes usar una clave SSH para push en la sección siguiente.
        </p>
        <div>
          <button
            type="submit"
            className="ghost"
            disabled={!token.trim() || guardarToken.isPending}
          >
            Guardar token cifrado
          </button>
        </div>
      </form>
      {guardar.isSuccess && <p role="status">Configuración guardada.</p>}
      {guardarToken.isSuccess && <p role="status">Token guardado.</p>}
      {comprobar.data && (
        <p role="status">
          Acceso a {comprobar.data.repo}.{" "}
          {comprobar.data.push
            ? "Permiso para subir confirmado."
            : "GitHub no confirmó permiso de escritura; revisa los permisos del token."}
        </p>
      )}
      {[guardar.error, guardarToken.error, comprobar.error, iniciar.error]
        .filter(Boolean)
        .map((e, i) => (
          <p className="error" role="alert" key={i}>
            {errorText(e)}
          </p>
        ))}
      {accion && (
        <RepositoryApproval
          accion={accion}
          onChange={() => {
            setAccion(null);
            void qc.invalidateQueries({ queryKey: ["project-git", id] });
            void qc.invalidateQueries({ queryKey: ["project", id] });
          }}
        />
      )}
    </section>
  );
}

function ImportarSkills({ id }: { id: string }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(""),
    [contenido, setContenido] = useState(""),
    [url, setUrl] = useState("");
  const [abierto, setAbierto] = useState(false);
  const buscar = useMutation({ mutationFn: () => api.searchSkills(nombre) });
  const guardar = useMutation({
    mutationFn: (body: { name?: string; content?: string; url?: string }) =>
      api.saveProjectSkill(id, body),
    onSuccess: () => {
      setContenido("");
      setUrl("");
      setNombre("");
      setAbierto(false);
      void qc.invalidateQueries({ queryKey: ["skills", id] });
    },
  });
  return (
    <section className="panel approval-panel" aria-label="Importar skills">
      <h2>Importar skills</h2>
      <p className="hint">
        Se incluyen como instrucciones en cada tarea y chat de este proyecto. Puedes pegar un
        prompt, importar un SKILL.md de GitHub o buscar por nombre.
      </p>
      <button
        type="button"
        className="ghost"
        aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
      >
        {abierto ? "Cerrar formulario" : "Nueva skill"}
      </button>
      {abierto && (
        <div className="project-config-form">
          <label>
            Nombre
            <input
              value={nombre}
              placeholder="por-ejemplo-ssh"
              maxLength={64}
              onChange={(e) => setNombre(e.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              className="ghost"
              disabled={!nombre.trim() || buscar.isPending}
              onClick={() => buscar.mutate()}
            >
              Buscar en catálogos oficiales
            </button>
          </div>
          {buscar.isSuccess && buscar.data.length === 0 && (
            <p>Sin coincidencias. Pega las instrucciones o la URL de tu SKILL.md.</p>
          )}
          {buscar.data?.map((s) => (
            <div key={s.url} className="skill-entry">
              <span>{s.name}</span>
              <button
                type="button"
                className="ghost"
                disabled={guardar.isPending}
                onClick={() => guardar.mutate({ url: s.url })}
              >
                Instalar {s.name}
              </button>
            </div>
          ))}
          <label>
            Instrucciones o prompt
            <textarea
              rows={5}
              maxLength={16000}
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              placeholder="Pega aquí el contenido de la skill"
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!nombre.trim() || !contenido.trim() || guardar.isPending}
            onClick={() => guardar.mutate({ name: nombre, content: contenido })}
          >
            Guardar instrucciones
          </button>
          <label>
            URL del SKILL.md en GitHub
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/…/blob/main/…/SKILL.md"
            />
          </label>
          <button
            type="button"
            className="ghost"
            disabled={!url.trim() || guardar.isPending}
            onClick={() => guardar.mutate({ url })}
          >
            Importar SKILL.md
          </button>
          <p className="hint">
            Se instala solo el documento. No se descargan ni ejecutan scripts o archivos adjuntos.
          </p>
        </div>
      )}
      {[buscar.error, guardar.error].filter(Boolean).map((e, i) => (
        <p key={i} className="error" role="alert">
          {errorText(e)}
        </p>
      ))}
    </section>
  );
}

function ContextoProyecto({ id }: { id: string }) {
  const qc = useQueryClient();
  const contexto = useQuery({
    queryKey: ["project-context", id],
    queryFn: () => api.projectContext(id),
  });
  const guardar = useMutation({
    mutationFn: (compartir: boolean) => api.saveProjectContext(id, compartir),
    onMutate: async (compartir) => {
      await qc.cancelQueries({ queryKey: ["project-context", id] });
      const previo = qc.getQueryData(["project-context", id]);
      qc.setQueryData(
        ["project-context", id],
        (actual: { compartir: boolean; chats: unknown[] } | undefined) =>
          actual ? { ...actual, compartir } : actual,
      );
      return { previo };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previo) qc.setQueryData(["project-context", id], ctx.previo);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["project-context", id] }),
  });
  return (
    <section className="panel approval-panel" aria-label="Contexto de los chats">
      <h2>Contexto de los chats</h2>
      <p>
        Cada chat conserva su propio historial. También puedes compartir con las nuevas tareas los
        mensajes recientes de los otros chats de este proyecto.
      </p>
      <div className="project-config-form">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={contexto.data?.compartir ?? false}
            disabled={!contexto.data || guardar.isPending}
            onChange={(e) => guardar.mutate(e.target.checked)}
          />
          Compartir contexto entre chats del proyecto
        </label>
      </div>
      <p className="hint">
        Hasta 20 mensajes recientes y 16 000 caracteres. Las instrucciones, skills y memoria del
        proyecto se añaden por separado.
      </p>
      <ul>
        {contexto.data?.chats.map((c) => (
          <li key={c.id}>
            {c.title} · {c.mensajes} mensajes
          </li>
        ))}
      </ul>
      {contexto.data?.chats.length === 0 && <p>Aún no hay chats en este proyecto.</p>}
      {(contexto.isError || guardar.isError) && (
        <p role="alert" className="error">
          {errorText(contexto.error ?? guardar.error)}
        </p>
      )}
    </section>
  );
}
