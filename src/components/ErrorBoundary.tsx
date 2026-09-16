import { Component, type ReactNode } from "react";
import { debug } from "../world/debugLog";

type Props = {
  children: ReactNode;
  /** Nombre del área protegida (sale en el mensaje y el log). */
  area?: string;
};

type State = { error: Error | null };

/**
 * Atrapa crashes de render (p. ej. WorldMap/Pixi) y muestra el error en
 * pantalla en vez de dejar el panel vacío. El error también va al debugLog.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    debug.error(`ErrorBoundary[${this.props.area ?? "map"}]:`, error.message, error.stack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 24, color: "#ffd7d7", background: "#2a1215", borderRadius: 8, maxWidth: 640 }}>
        <h3 style={{ margin: "0 0 8px" }}>El mapa no pudo dibujarse ({this.props.area ?? "map"})</h3>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{String(error.message)}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => window.location.reload()}>Recargar</button>
          <button type="button" onClick={() => debug.download()}>Descargar log</button>
        </div>
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          Abre con <code>?debug=1</code> en la URL para ver tiempos y detalle en consola.
        </p>
      </div>
    );
  }
}
