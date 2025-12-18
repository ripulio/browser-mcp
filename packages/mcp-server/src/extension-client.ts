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
import { getOrCreateSession, generateCallId } from "./session.js";
import { startServer as startWsServer, send, isSocketConnected, getActivePort as getWsActivePort } from "./ws-server.js";

// Default session ID for stdio transport (single client mode)
export const DEFAULT_SESSION_ID = "default";

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
    }, 5000);

    session.pendingConnect = { resolve, reject, timeout };

    send({ type: ServerMessageType.CONNECT, sessionId });
  });
}

export async function openTab(
  url: string,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<TabInfo> {
  return new Promise((resolve, reject) => {
    if (!isSocketConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);
    const requestId = generateCallId(session, "open");

    const timeout = setTimeout(() => {
      session.pendingOpenTabs.delete(requestId);
      reject(new Error("Timeout waiting for tab to open"));
    }, 30000);

    session.pendingOpenTabs.set(requestId, { resolve, reject, timeout });

    send({ type: ServerMessageType.OPEN_TAB, sessionId, url, focus: true, requestId });
  });
}

export async function closeTab(
  tabId: number,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isSocketConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);

    if (session.pendingCloseTabs.has(tabId)) {
      reject(new Error(`Already closing tab ${tabId}`));
      return;
    }

    const timeout = setTimeout(() => {
      session.pendingCloseTabs.delete(tabId);
      reject(new Error("Timeout waiting for tab close"));
    }, 5000);

    session.pendingCloseTabs.set(tabId, { resolve, reject, timeout });
    send({ type: ServerMessageType.CLOSE_TAB, sessionId, tabId });
  });
}

export async function callPageTool(
  tabId: number,
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isSocketConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);
    const callId = generateCallId(session, "call");
    session.pendingCalls.set(callId, { resolve, reject });

    send({ type: ServerMessageType.CALL_TOOL, sessionId, callId, tabId, toolName, args });

    setTimeout(() => {
      if (session.pendingCalls.has(callId)) {
        session.pendingCalls.delete(callId);
        reject(new Error("Timeout waiting for tool result"));
      }
    }, 30000);
  });
}

export async function discoverToolsForTab(
  tabId: number,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isSocketConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);
    const callId = generateCallId(session, "discover");
    session.pendingCalls.set(callId, { resolve, reject });

    send({ type: ServerMessageType.DISCOVER_TOOLS, sessionId, callId, tabId });

    setTimeout(() => {
      if (session.pendingCalls.has(callId)) {
        session.pendingCalls.delete(callId);
        reject(new Error("Timeout waiting for tool discovery"));
      }
    }, 10000);
  });
}
