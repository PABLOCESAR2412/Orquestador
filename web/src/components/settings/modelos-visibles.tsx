import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Preferences } from "../../api";
import { errorText } from "../../lib/model";

export function ModelosVisibles({ proveedor, authPendiente = false }: { proveedor: string; authPendiente?: boolean }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const catalogo = useQuery({ queryKey: ["models"], queryFn: api.listModels });
  const preferencias = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const refrescar = useMutation({ mutationFn: api.refreshModels, onSuccess: datos => {
    qc.setQueryData(["models"], datos);
    void qc.invalidateQueries({ queryKey: ["providers"] });
  } });
  const guardar = useMutation({
    mutationFn: (modelVisibility: Record<string, boolean>) => api.savePreferences({ modelVisibility }),
    onMutate: modelVisibility => {
      void qc.cancelQueries({ queryKey: ["preferences"] });
      const previo = qc.getQueryData<Preferences>(["preferences"]);
      if (previo) qc.setQueryData(["preferences"], { ...previo, modelVisibility });
      return previo;
    },
    onError: (_error, _variables, previo) => { if (previo) qc.setQueryData(["preferences"], previo); },
    onSuccess: next => {
      qc.setQueryData(["preferences"], next);
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const modelos = catalogo.data?.models.filter(m => m.provider === proveedor && `${m.name} ${m.id}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase())) ?? [];
  return <div className="aj-modelos-visibles">
    <p className="aj-nota">Elige los modelos que aparecerán en el selector del chat. Los cambios se guardan al marcar cada modelo.</p>
    <button type="button" className="aj-btn" disabled={refrescar.isPending} onClick={() => refrescar.mutate()}>{refrescar.isPending ? "Actualizando…" : "Actualizar modelos"}</button>
    <input className="aj-input" type="search" aria-label={`Buscar modelos de ${proveedor}`} placeholder="Buscar modelo…" value={busca} onChange={e => setBusca(e.target.value)} />
    <div className="aj-lista-modelos" aria-label={`Modelos visibles de ${proveedor}`}>
      {modelos.map(m => <label key={m.id} className="aj-modelo-opcion">
        <input type="checkbox" checked={preferencias.data?.modelVisibility?.[m.id] ?? m.recommended} disabled={!preferencias.data || guardar.isPending} onChange={e => guardar.mutate({ ...preferencias.data?.modelVisibility, [m.id]: e.target.checked })} />
        <span>{m.name}<small>{m.id}</small></span>
      </label>)}
    </div>
    {(catalogo.isPending || preferencias.isPending) && <p role="status" className="aj-nota">Consultando modelos…</p>}
    {!catalogo.isPending && !modelos.length && !authPendiente && <p className="aj-nota">No hay modelos disponibles. Comprueba la conexión o la sesión de esta integración.</p>}
    {(guardar.error || catalogo.error || refrescar.error) && <p role="alert" className="aj-error">{errorText(guardar.error ?? catalogo.error ?? refrescar.error)}</p>}
  </div>;
}
