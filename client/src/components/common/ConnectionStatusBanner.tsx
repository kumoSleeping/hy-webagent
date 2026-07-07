import { useConnectionState } from "../../context/useChatConnection";

export function ConnectionStatusBanner() {
  const state = useConnectionState();

  if (state === 'connected' || state === 'disconnected') return null;

  return (
    <div className="pi-connection-banner">
      {state === 'connecting' && (
        <span className="pi-connection-banner__text">Connecting…</span>
      )}
      {state === 'reconnecting' && (
        <span className="pi-connection-banner__text">Connection lost — reconnecting…</span>
      )}
    </div>
  );
}
