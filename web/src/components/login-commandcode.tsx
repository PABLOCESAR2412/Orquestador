import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";

export function LoginCommandCodePanel() {
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.listProviders });
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = providers.data?.find((provider) => provider.id === "commandcode");
  const save = useMutation({
    mutationFn: (value: string) => api.setProviderKey("commandcode", value),
    onSuccess: () => {
      setKey("");
      setError(null);
      setMessage("Clave guardada cifrada. Command Code CLI ya puede consultar los modelos de tu plan Go.");
      void qc.invalidateQueries({ queryKey: ["providers"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (reason) => { setMessage(null); setError(errorText(reason)); },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteProviderKey("commandcode"),
    onSuccess: () => {
      setKey("");
      setMessage("Clave quitada. La CLI volverá a usar el login guardado en el servidor, si existe.");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["providers"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (reason) => { setMessage(null); setError(errorText(reason)); },
  });
  const busy = save.isPending || remove.isPending;

  return <section className="login-commandcode" aria-label="Conectar Command Code Go">
    <h3>Conectar Command Code Go</h3>
    <details className="aj-nota">
      <summary>Iniciar sesión con cmdc login por SSH</summary>
      <p>El callback apunta a 127.0.0.1 dentro de la VM, pero el navegador se abre en tu PC. Mantén cmdc esperando en la terminal SSH.</p>
      <p>En otra terminal de tu PC, crea un túnel para el puerto que aparece en el callback. Para el puerto de esta captura:</p>
      <p><code>ssh -N -L 41679:127.0.0.1:41679 orquestador@test</code></p>
      <p>Ejecuta esto en Windows, cambia orquestador@test por el mismo destino SSH que usas y reemplaza 41679 si el CLI muestra otro puerto. Deja abierto el túnel; vuelve a la URL de autorización original y completa el login.</p>
    </details>
    <p className="aj-nota">También puedes pegar una API key de CLI abajo. Telo la guarda cifrada y se la entrega a Command Code CLI solo para sus modelos; se aplican los límites compartidos del plan Go y no se habilita la Provider API.</p>
    {status?.sesion && <p className="aj-nota" role="status">Command Code está autenticado en el servidor.</p>}
    {status?.guardada && <p className="aj-nota">Ya hay una clave cifrada. Al guardar otra, la reemplazas.</p>}
    <label className="aj-campo" htmlFor="commandcode-api-key">
      <span className="aj-campo-etiqueta">API key de Command Code Go</span>
      <input
        id="commandcode-api-key"
        className="aj-input aj-mono"
        type="password"
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Pega la clave"
        value={key}
        disabled={busy}
        onChange={(event) => setKey(event.target.value)}
      />
    </label>
    <div className="instalar-acciones">
      <button type="button" className="aj-btn aj-btn-primario" disabled={!key.trim() || busy} onClick={() => save.mutate(key.trim())}>
        {save.isPending ? "Guardando…" : "Guardar y conectar"}
      </button>
      {status?.guardada && <button type="button" className="aj-btn" disabled={busy} onClick={() => remove.mutate()}>{remove.isPending ? "Quitando…" : "Quitar clave"}</button>}
    </div>
    {message && <p className="aj-nota" role="status">{message}</p>}
    {error && <p className="aj-error" role="alert">{error}</p>}
    <p className="aj-nota"><a href="https://commandcode.ai/docs/headless" target="_blank" rel="noreferrer">Guía oficial de autenticación headless</a></p>
  </section>;
}