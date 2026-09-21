export function OfflineOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="offlineOverlay">
      <div className="offlineOverlayContent">
        <span className="offlineIcon">🔌❌</span>
        <h1 className="offlineTitle">OFFLINE</h1>
        <p className="offlineMessage">Servidor Ollama desconectado</p>
        <p className="offlineSub">Esperando reconexión…</p>
      </div>
    </div>
  );
}
