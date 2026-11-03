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
    <p className="aj-nota">
      En la VM, Command Code recomienda una API key de CLI porque no hay navegador para completar OAuth. Telo la guarda cifrada y la entrega a Command Code CLI solo para sus modelos. Esto usa los límites compartidos del plan Go; no habilita la Provider API.
    </p>
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