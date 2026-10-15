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
              disabled={comprobar.isPending || !!edicion || !data?.remote?.trim()}
              onClick={() => comprobar.mutate()}
              title={!data?.remote?.trim() ? "Configura y guarda primero la URL del repositorio remoto de GitHub" : undefined}
            >
              {comprobar.isPending ? "Comprobando…" : "Comprobar acceso con token"}
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
          ? "Acceso mediante token del proyecto o cuenta de GitHub en Ajustes."
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
          Usa un token limitado a este repositorio con Contents de escritura para subir. Para crear
          pull requests guarda aparte un token solo con Pull requests como GITHUB_PR_TOKEN en Secretos.
          Puedes usar una clave SSH para subir en la sección siguiente.
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

