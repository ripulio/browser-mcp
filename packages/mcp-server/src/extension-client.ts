/**
 * Extension Client - Public API
 *
 * This module provides the public interface for interacting with the browser
 * extension. It exposes high-level functions for browser automation:
 * - connectToExtension: Establish connection and get browser info
 * - openTab: Open a new browser tab
 * - closeTab: Close an existing tab
 * - callPageTool: Execute a tool exposed by a web page
 * - discoverToolsForTab: Discover available tools on a tab
 *
 * All operations are session-aware to support multiple concurrent MCP clients.
 * This module delegates WebSocket communication to ws-server.ts and message
 * handling to message-handler.ts.
 */

import { TabInfo } from "./types.js";
import { ServerMessageType } from "./message-types.js";
import { getOrCreateSession, generateCallId, Session } from "./session.js";
import { startServer as startWsServer, send, isSocketConnected, getActivePort as getWsActivePort } from "./ws-server.js";

// Timeout values in milliseconds
const TIMEOUTS = {
  CONNECT: 5000,
  OPEN_TAB: 30000,
  CLOSE_TAB: 5000,
  TOOL_CALL: 30000,
  TOOL_DISCOVERY: 10000,
} as const;

// Default session ID for stdio transport (single client mode)
export const DEFAULT_SESSION_ID = "default";

// Generic pending operation type
interface PendingOperation<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// Helper to check connection and throw if not connected
function requireConnection(): void {
  if (!isSocketConnected()) {
    throw new Error("Not connected to browser");
  }
}

// Low-level helper to create pending operations with timeout handling
function createPendingOperation<T, K extends string | number>(
  pendingMap: Map<K, PendingOperation<T>>,
  key: K,
  timeoutMs: number,
  timeoutMessage: string,
  sendMessage: () => void
): Promise<T> {
  requireConnection();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingMap.delete(key);
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    pendingMap.set(key, { resolve, reject, timeout });
    sendMessage();
  });
}

// Higher-level helper that handles session + callId generation
function createCallOperation<T>(
  sessionId: string,
  prefix: string,
  getPendingMap: (session: Session) => Map<string, PendingOperation<T>>,
  timeoutMs: number,
  timeoutMessage: string,
  sendMessage: (callId: string) => void
): Promise<T> {
  const session = getOrCreateSession(sessionId);
  const callId = generateCallId(session, prefix);
  return createPendingOperation(
    getPendingMap(session),
    callId,
    timeoutMs,
    timeoutMessage,
    () => sendMessage(callId)
  );
}

// Re-export ws-server functions
export const startServer = startWsServer;
export const getActivePort = getWsActivePort;

export function isConnected(): boolean {
  return isSocketConnected();
}

export function connectToExtension(
  sessionId: string = DEFAULT_SESSION_ID
): Promise<{ name: string; version: string; tabCount: number }> {
  return new Promise((resolve, reject) => {
    const session = getOrCreateSession(sessionId);

    if (session.connectInProgress) {
      reject(new Error("Connection already in progress"));
      return;
    }

    if (!isSocketConnected()) {
      reject(new Error("Extension not connected. Please ensure the browser extension is installed and enabled."));
      return;
    }

    session.connectInProgress = true;

    const timeout = setTimeout(() => {
      session.connectInProgress = false;
      session.pendingConnect = null;
      reject(new Error("Connection timeout - extension did not respond"));
    }, TIMEOUTS.CONNECT);

    session.pendingConnect = { resolve, reject, timeout };

    send({ type: ServerMessageType.CONNECT, sessionId });
  });
}

export function openTab(
  url: string,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<TabInfo> {
  return createCallOperation(
    sessionId,
    "open",
    (s) => s.pendingOpenTabs,
    TIMEOUTS.OPEN_TAB,
    "Timeout waiting for tab to open",
    (requestId) => send({ type: ServerMessageType.OPEN_TAB, sessionId, url, focus: true, requestId })
  );
}

export function closeTab(
  tabId: number,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<void> {
  const session = getOrCreateSession(sessionId);

  if (session.pendingCloseTabs.has(tabId)) {
    return Promise.reject(new Error(`Already closing tab ${tabId}`));
  }

  return createPendingOperation(
    session.pendingCloseTabs,
    tabId,
    TIMEOUTS.CLOSE_TAB,
    "Timeout waiting for tab close",
    () => send({ type: ServerMessageType.CLOSE_TAB, sessionId, tabId })
  );
}

export function callPageTool(
  tabId: number,
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<unknown> {
  return createCallOperation(
    sessionId,
    "call",
    (s) => s.pendingCalls,
    TIMEOUTS.TOOL_CALL,
    "Timeout waiting for tool result",
    (callId) => send({ type: ServerMessageType.CALL_TOOL, sessionId, callId, tabId, toolName, args })
  );
}

export function discoverToolsForTab(
  tabId: number,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<unknown> {
  return createCallOperation(
    sessionId,
    "discover",
    (s) => s.pendingCalls,
    TIMEOUTS.TOOL_DISCOVERY,
    "Timeout waiting for tool discovery",
    (callId) => send({ type: ServerMessageType.DISCOVER_TOOLS, sessionId, callId, tabId })
  );
}
