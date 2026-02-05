import { useEffect, useCallback } from "react";
import { useWs } from "../context/WsContext.js";

// Convenience hook for subscribing to WS messages
export function useWsMessage(type: string, handler: (msg: any) => void) {
  const { subscribe } = useWs();

  useEffect(() => {
    return subscribe(type, handler);
  }, [type, handler, subscribe]);
}

// Re-export for convenience
export { useWs } from "../context/WsContext.js";
