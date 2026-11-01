// Aviso de cuota agotada: dice qué modelo se quedó sin tokens, deja cambiarlo y seguir desde el último punto.
// Lo usan las tareas (sin_cuota) y los chats (cuota_modelo). Seguir solo se activa con otro modelo.
type Props = {
  modeloAgotado: string;
  modeloSeleccionado?: string;
  puedeSeguir: boolean;
  seguirPendiente?: boolean;
  onCambiarModelo: () => void;
  onSeguir: () => void;
  error?: string | null;
};

export function AvisoCuota({
  modeloAgotado,
  modeloSeleccionado,
  puedeSeguir,
  seguirPendiente = false,
  onCambiarModelo,
  onSeguir,
  error = null,
}: Props) {
  return (
    <section className="cuota-aviso" aria-label="Sin cuota">
      <p className="cuota-aviso-titulo">La ejecución anterior se pausó por cuota en {modeloAgotado}.</p>
      <p className="cuota-aviso-texto">
        {modeloSeleccionado && <>Modelo seleccionado para continuar: <strong>{modeloSeleccionado}</strong>. </>}
        {puedeSeguir ? "Pulsa Seguir para iniciar con ese modelo y conservar el trabajo anterior." : "Elige otro modelo y pulsa Seguir para conservar el trabajo anterior."}
      </p>
      <p className="cuota-aviso-ayuda">
        Este límite depende de la cuenta o clave del proveedor del modelo; ChatGPT Plus se administra por separado.
      </p>
      <div className="cuota-aviso-acciones">
        <button type="button" className="ghost" onClick={onCambiarModelo}>
          Cambiar modelo
        </button>
        <button type="button" className="primary" onClick={onSeguir} disabled={!puedeSeguir || seguirPendiente}>
          {seguirPendiente ? "Siguiendo…" : "Seguir"}
        </button>
      </div>
      {!puedeSeguir && <p className="cuota-aviso-ayuda">Elige otro modelo para activar Seguir.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
