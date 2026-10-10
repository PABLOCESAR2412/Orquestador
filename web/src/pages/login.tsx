import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";

// Pantalla de entrada: sin sesión, la app solo muestra esta página.
export function LoginPage() {
  const [clave, setClave] = useState("");

  // Si la sesión ya es válida, no hace falta volver a escribir la clave.
  useEffect(() => {
    api
      .sesion()
      .then(() => location.replace("/chat"))
      .catch(() => {});
  }, []);

  const entrar = useMutation({
    mutationFn: (valor: string) => api.login(valor),
    // Recarga completa: así las consultas empiezan limpias con la sesión nueva.
    onSuccess: () => location.assign("/chat"),
  });

  return (
    <main className="login">
      <form
        className="panel login-box"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (clave && !entrar.isPending) entrar.mutate(clave);
        }}
      >
        <h1>Entrar a Telo</h1>
        <p className="muted-note">Escribe la clave de acceso de tu servidor.</p>
        <label className="field-label" htmlFor="clave">
          Clave de acceso
        </label>
        <input
          id="clave"
          name="clave"
          className="text-input login-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={clave}
          onChange={(e) => setClave(e.target.value)}
        />
        {entrar.isError && (
          <p className="error" role="alert">
            {errorText(entrar.error)}
          </p>
        )}
        <button type="submit" className="primary login-btn" disabled={!clave || entrar.isPending}>
          {entrar.isPending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
