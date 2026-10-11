import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText, formatUsd } from "../lib/model";

// Proveedores que Telo ya conoce. El campo acepta cualquier nombre en minúsculas.
const PROVEEDORES_CONOCIDOS = ["opencode", "codex", "google", "openrouter", "groq", "nvidia", "openai"];

// Uso y saldo por proveedor y clave. Los saldos son estimados: el saldo anotado menos el uso
// que Telo registró después. Ningún proveedor se consulta en vivo todavía.
export function CuotasPanel({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient();
  const cuotas = useQuery({ queryKey: ["cuotas"], queryFn: api.listQuotas, refetchInterval: 15_000 });

  const [proveedor, setProveedor] = useState("opencode");
  const [etiqueta, setEtiqueta] = useState("");
  const [monto, setMonto] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [montoEditado, setMontoEditado] = useState("");

  const invalidar = () => qc.invalidateQueries({ queryKey: ["cuotas"] });

  const crear = useMutation({
    mutationFn: () =>
      api.createQuota({
        provider: proveedor.trim().toLowerCase(),
        label: etiqueta.trim(),
        remainingUsd: Number(monto.replace(",", ".")),
      }),
    onSuccess: () => {
      setEtiqueta("");
      setMonto("");
      void invalidar();
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ id, valor }: { id: string; valor: number }) => api.updateQuota(id, { remainingUsd: valor }),
    onSuccess: () => {
      setEditando(null);
      void invalidar();
    },
  });

  const quitar = useMutation({
    mutationFn: (id: string) => api.deleteQuota(id),
    onSettled: () => void invalidar(),
  });

  const error = crear.isError
    ? errorText(crear.error)
    : actualizar.isError
      ? errorText(actualizar.error)
      : quitar.isError
        ? errorText(quitar.error)
        : null;

  return (
    <section className="panel cuotas" aria-label="Uso y saldo por proveedor">
      <div className="card-top">
        <h2>Uso y saldo</h2>
        <button type="button" className="ghost task-mini-btn" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      <p className="muted-note">
        Telo resta el uso que registra desde que anotas un saldo. Son estimados: ningún proveedor muestra aquí su saldo en vivo todavía.
      </p>

      {cuotas.isLoading && <p className="muted-note">Cargando…</p>}
      {cuotas.isError && <p className="error" role="alert">No se pudo cargar el uso.</p>}

      {cuotas.data?.proveedores.map((p) => (
        <div key={p.id} className="cuota-proveedor">
          <div className="cuota-proveedor-head">
            <span className="project-name">{p.nombre}</span>
            <span className="muted-note">Gasto de este mes: {formatUsd(p.gastoMesUsd)}</span>
          </div>

          {p.cuentas.length === 0 && <p className="muted-note">Sin saldo anotado.</p>}

          <ul className="cuota-lista">
            {p.cuentas.map((c) => (
              <li key={c.id} className="cuota-row">
                <div className="cuota-info">
                  <span className="project-name">{c.label}</span>
                  <span className="muted-note">
                    Anotado {formatUsd(c.anotadoUsd)} · uso desde entonces {formatUsd(c.usoDesdeAnotacionUsd)}
                  </span>
                </div>
                <div className="cuota-saldo">
                  <strong>{formatUsd(c.saldoEstimadoUsd)}</strong>
                  <span className="muted-note">estimado</span>
                </div>

                {editando === c.id ? (
                  <form
                    className="cuota-editar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      actualizar.mutate({ id: c.id, valor: Number(montoEditado.replace(",", ".")) });
                    }}
                  >
                    <input
                      inputMode="decimal"
                      aria-label={`Nuevo saldo de ${c.label}`}
                      value={montoEditado}
                      onChange={(e) => setMontoEditado(e.target.value)}
                    />
                    <button type="submit" className="primary task-mini-btn" disabled={actualizar.isPending}>
                      Guardar
                    </button>
                    <button type="button" className="ghost task-mini-btn" onClick={() => setEditando(null)}>
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <div className="cuota-acciones">
                    <button
                      type="button"
                      className="ghost task-mini-btn"
                      onClick={() => {
                        setEditando(c.id);
                        setMontoEditado(String(c.anotadoUsd));
                      }}
                    >
                      Actualizar saldo
                    </button>
                    <button
                      type="button"
                      className="ghost task-mini-btn"
                      onClick={() => quitar.mutate(c.id)}
                      disabled={quitar.isPending}
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <form
        className="cuota-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (proveedor.trim() && etiqueta.trim() && monto.trim()) crear.mutate();
        }}
      >
        <span className="field-label">Anotar saldo de una cuenta o clave</span>
        <label className="cuota-campo">
          <span className="muted-note">Proveedor</span>
          <input
            list="cuota-proveedores"
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            autoCapitalize="none"
          />
          <datalist id="cuota-proveedores">
            {PROVEEDORES_CONOCIDOS.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <label className="cuota-campo">
          <span className="muted-note">Nombre de la cuenta o clave</span>
          <input
            value={etiqueta}
            maxLength={60}
            placeholder="Clave principal"
            onChange={(e) => setEtiqueta(e.target.value)}
          />
        </label>
        <label className="cuota-campo">
          <span className="muted-note">Saldo restante (US$)</span>
          <input inputMode="decimal" value={monto} placeholder="10.00" onChange={(e) => setMonto(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={crear.isPending}>
          Anotar saldo
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
