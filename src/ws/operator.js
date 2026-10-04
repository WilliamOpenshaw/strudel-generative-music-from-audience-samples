/**
 * operator.js — Operator WebSocket client for receiving audience actions
 * and managing lock states in the Strudel Dashboard.
 */

import { MSG } from './protocol.js';

let ws = null;
let reconnectTimeout = null;

export function initOperatorWS({ onAction, onStatus, onAccessUpdate, onOpen }) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws?role=operator`;

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[ws-operator] WebSocket init failed:', e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.info('[ws-operator] Connected to server as operator');
      if (onStatus) onStatus({ connected: true, audienceCount: 0 });
      if (onOpen) onOpen();
    };

    ws.onclose = () => {
      console.warn('[ws-operator] Disconnected');
      if (onStatus) onStatus({ connected: false, audienceCount: 0 });
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[ws-operator] Error:', err);
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === MSG.AUDIENCE_ACTION && onAction) {
        onAction(msg.action, msg.timestamp);
      } else if (msg.type === MSG.STATUS && onStatus) {
        onStatus({ connected: true, audienceCount: msg.audienceCount || 0 });
      } else if (msg.type === MSG.ACCESS_UPDATE && onAccessUpdate) {
        onAccessUpdate(msg.access);
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connect, 2000);
  }

  connect();

  return {
    /** @param {{ all?: boolean, music?: boolean }} access */
    setAccess: (access) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MSG.SET_ACCESS, access }));
      }
    },
    syncPads: ({ padLabels, padKinds, bankTitle }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MSG.SYNC_PADS, padLabels, padKinds, bankTitle }));
      }
    }
  };
}
