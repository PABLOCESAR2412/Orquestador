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
    </>
  );
}
function ProyectoGit({ id }: { id: string }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["project-git", id], queryFn: () => api.projectGit(id) });
  const [edicion, setEdicion] = useState<Pick<
    GitConfig,
    "remote" | "author_name" | "base_branch"
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
  const data = edicion ?? cfg.data;
  const cambiar = (
    campo: "remote" | "author_name" | "base_branch",
    valor: string,
  ) => {
    if (data)
      setEdicion({
        remote: data.remote ?? "",
        author_name: data.author_name,
        base_branch: data.base_branch,
        [campo]: valor,
      });
  };
  return (
    <section className="panel approval-panel" aria-label="Git y GitHub">
      <h2>Git y GitHub</h2>
      <p className="hint">
        La GitHub App vinculada en Ajustes revisa este repositorio y autoriza subidas y pull requests con permisos temporales.
        El nombre identifica tus commits; la rama indica el destino de los pull requests.
      </p>
      {cfg.data?.github.conectado ? (
        <p role="status">
          {cfg.data.github.metodo === "app" ? "GitHub App vinculada" : "Sesión de GitHub anterior"} en {cfg.data.github.name} (@{cfg.data.github.login}).
        </p>
      ) : (
        <p>Sin sesión de GitHub. Puedes conectar una cuenta en Ajustes.</p>
      )}
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
              readOnly={Boolean(cfg.data?.remote)}
              aria-readonly={Boolean(cfg.data?.remote)}
              title={cfg.data?.remote ? "El repositorio queda fijado al configurarlo." : undefined}
              onChange={(e) => cambiar("remote", e.target.value)}
            />
          </label>
          {cfg.data?.repository && <p className="hint">Repositorio detectado: {cfg.data.repository}</p>}
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
              disabled={comprobar.isPending || !!edicion || !data?.remote?.trim()}
              onClick={() => comprobar.mutate()}
              title={!data?.remote?.trim() ? "Configura y guarda primero la URL del repositorio remoto de GitHub" : undefined}
            >
              {comprobar.isPending ? "Comprobando…" : "Comprobar acceso a GitHub"}
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
        {cfg.data?.github.conectado
          ? cfg.data.github.metodo === "app"
            ? `Usando la GitHub App; Telo limita cada credencial a ${cfg.data.repository ?? "este repositorio"}.`
            : `Usando la sesión global anterior de GitHub${cfg.data.github.login ? ` (@${cfg.data.github.login})` : ""}.`
          : cfg.data?.token
            ? "Acceso mediante token guardado en este proyecto."
          : cfg.data?.ssh
            ? "Clave SSH del proyecto configurada."
            : "Vincula la instalación de GitHub App en Ajustes para clonar repositorios privados y subir cambios."}
      </p>
      {guardar.isSuccess && <p role="status">Configuración guardada.</p>}
      {comprobar.data && (
        <p role="status">
          Acceso a {comprobar.data.repo}.{" "}
          {comprobar.data.push
            ? "Permiso para subir confirmado."
            : "GitHub no confirmó permiso de escritura; revisa los permisos del token."}
        </p>
      )}
      {[guardar.error, comprobar.error, iniciar.error]
        .filter(Boolean)
        .map((e, i) => (
          <p className="error" role="alert" key={i}>
            {errorText(e)}
          </p>
        ))}
      {accion && (
        <RepositoryApproval
          accion={accion}
          projectId={id}
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

