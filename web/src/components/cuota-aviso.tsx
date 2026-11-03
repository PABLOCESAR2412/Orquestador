// Aviso de cuota agotada: dice qué modelo se quedó sin tokens, deja cambiarlo y seguir desde el último punto.
// Lo usan las tareas (sin_cuota) y los chats (cuota_modelo). Seguir solo se activa con otro modelo.
type Props = {
  modeloAgotado: string;
  puedeSeguir: boolean;
  seguirPendiente?: boolean;
  onCambiarModelo: () => void;
  onSeguir: () => void;
  error?: string | null;
};

export function AvisoCuota({
  modeloAgotado,
  puedeSeguir,
  seguirPendiente = false,
  onCambiarModelo,
  onSeguir,
  error = null,
}: Props) {
  return (
    <section className="cuota-aviso" aria-label="Sin cuota">
      <p className="cuota-aviso-titulo">Se acabó la cuota de {modeloAgotado}.</p>
      <p className="cuota-aviso-texto">
        Cambia de modelo y pulsa Seguir. Continúa donde se quedó, sin repetir lo que ya hizo.
      </p>
      <p className="cuota-aviso-ayuda">
        El proveedor rechazó la llamada por su límite de uso. El precio $0 no garantiza acceso ni muestra cuántas solicitudes quedan; Telo no recibe ese contador en esta respuesta. Revisa el panel de la cuenta del proveedor.
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
