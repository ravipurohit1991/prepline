import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SessionEvent, SessionState } from '../api/types';

/**
 * Live cook-session state over WebSocket, with REST fallback and reconnect.
 * Every device connected to the same session sees the same replanned state.
 */
export function useSession(sessionId: string) {
  const [state, setState] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(
        `${protocol}://${window.location.host}/api/sessions/${sessionId}/ws`,
      );
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'state') setState(message as SessionState);
        else if (message.type === 'error') setError(message.message);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) retry = window.setTimeout(connect, 2000);
      };
    };

    connect();
    api
      .getSession(sessionId)
      .then((initial) => setState((current) => current ?? initial))
      .catch((e: Error) => setError(e.message));

    // Periodic resync keeps the plan honest when steps run long untouched.
    const sync = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'sync' }));
      }
    }, 30_000);

    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      window.clearInterval(sync);
      socketRef.current?.close();
    };
  }, [sessionId]);

  const send = useCallback(
    (event: SessionEvent) => {
      setError('');
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      } else {
        fetch(`/api/sessions/${sessionId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error((await response.json()).detail ?? 'request failed');
            setState(await response.json());
          })
          .catch((e: Error) => setError(e.message));
      }
    },
    [sessionId],
  );

  return { state, connected, error, send, clearError: () => setError('') };
}
