import { WebSocketServer, WebSocket } from "ws";
import { ExtensionMessage, ServerMessage, TabInfo } from "./types.js";
import {
  setConnected,
  addTab,
  updateTab,
  removeTab,
  updateTabTools,
  getState,
} from "./state.js";
import {
  getSession,
  getOrCreateSession,
  getAllSessions,
  generateCallId,
  extractSessionIdFromCallId,
  Session,
} from "./session.js";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const WS_PORT_START = 8765;
const WS_PORT_END = 8785; // Try up to 20 ports
const DISCOVERY_DIR = join(tmpdir(), "browser-mcp");

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let activePort: number | null = null;
let portFilePath: string | null = null;

// Default session ID for stdio transport (single client mode)
export const DEFAULT_SESSION_ID = "default";

/**
 * Find an available port in the range
 */
async function findAvailablePort(): Promise<number> {
  for (let port = WS_PORT_START; port <= WS_PORT_END; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = new WebSocketServer({ port });
        testServer.on("listening", () => {
          testServer.close();
          resolve();
        });
        testServer.on("error", reject);
      });
      return port;
    } catch {
      // Port in use, try next
      continue;
    }
  }
  throw new Error(`No available ports in range ${WS_PORT_START}-${WS_PORT_END}`);
}

/**
 * Write server info to discovery directory
 */
function writeDiscoveryFile(port: number): void {
  try {
    // Ensure discovery directory exists
    if (!existsSync(DISCOVERY_DIR)) {
      mkdirSync(DISCOVERY_DIR, { recursive: true });
    }

    const pid = process.pid;
    portFilePath = join(DISCOVERY_DIR, `server-${pid}.json`);

    const info = {
      port,
      pid,
      startedAt: Date.now(),
    };

    writeFileSync(portFilePath, JSON.stringify(info, null, 2));
    console.error(`Discovery file written: ${portFilePath}`);
  } catch (error) {
    console.error("Failed to write discovery file:", error);
  }
}

/**
 * Remove discovery file on shutdown
 */
function removeDiscoveryFile(): void {
  if (portFilePath && existsSync(portFilePath)) {
    try {
      unlinkSync(portFilePath);
      console.error(`Discovery file removed: ${portFilePath}`);
    } catch (error) {
      console.error("Failed to remove discovery file:", error);
    }
  }
}

// Cleanup on process exit
process.on("exit", removeDiscoveryFile);
process.on("SIGINT", () => {
  removeDiscoveryFile();
  process.exit(0);
});
process.on("SIGTERM", () => {
  removeDiscoveryFile();
  process.exit(0);
});

/**
 * Start the WebSocket server. Called once when MCP server starts.
 */
export async function startServer(): Promise<void> {
  if (wss) return;

  // Find available port
  activePort = await findAvailablePort();
  console.error(`Found available port: ${activePort}`);

  wss = new WebSocketServer({ port: activePort });
  console.error(`WebSocket server listening on ws://localhost:${activePort}`);

  // Write discovery file so extension can find us
  writeDiscoveryFile(activePort);

  wss.on("connection", (socket) => {
    console.error("Extension connected");

    // Only allow one extension connection
    if (extensionSocket) {
      console.error("Rejecting duplicate extension connection");
      socket.close();
      return;
    }

    extensionSocket = socket;

    socket.on("message", (data) => {
      let message: ExtensionMessage;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        console.error("Failed to parse message from extension:", error);
        return;
      }

      // Handle keepalive pings
      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      handleExtensionMessage(message);
    });

    socket.on("close", () => {
      console.error("Extension disconnected");
      extensionSocket = null;
      setConnected(false);

      // Reject all pending operations for all sessions
      for (const session of getAllSessions()) {
        rejectAllSessionPendingOps(session, "Connection closed");
      }
    });

    socket.on("error", (error) => {
      console.error("Extension socket error:", error.message);
    });
  });

  wss.on("error", (error) => {
    console.error("WebSocket server error:", error.message);
  });
}

function rejectAllSessionPendingOps(session: Session, reason: string): void {
  // Clean up pending calls
  for (const [, pending] of session.pendingCalls) {
    pending.reject(new Error(reason));
  }
  session.pendingCalls.clear();

  // Clean up pending open tabs
  for (const [, pending] of session.pendingOpenTabs) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  session.pendingOpenTabs.clear();

  // Clean up pending close tabs
  for (const [, pending] of session.pendingCloseTabs) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  session.pendingCloseTabs.clear();

  // Clean up pending connect
  if (session.pendingConnect) {
    session.connectInProgress = false;
    clearTimeout(session.pendingConnect.timeout);
    session.pendingConnect.reject(new Error(reason));
    session.pendingConnect = null;
  }
}

function handleExtensionMessage(message: ExtensionMessage): void {
  // Extract sessionId from message or callId
  let sessionId = (message as { sessionId?: string }).sessionId;

  // For messages with callId, extract sessionId from there
  if (!sessionId && "callId" in message) {
    sessionId = extractSessionIdFromCallId(message.callId) ?? DEFAULT_SESSION_ID;
  }

  // For messages with requestId, extract sessionId from there
  if (!sessionId && "requestId" in message && message.requestId) {
    sessionId = extractSessionIdFromCallId(message.requestId) ?? DEFAULT_SESSION_ID;
  }

  // Default to default session if no sessionId found
  if (!sessionId) {
    sessionId = DEFAULT_SESSION_ID;
  }

  switch (message.type) {
    case "connected": {
      setConnected(true, message.browser);
      for (const tab of message.tabs) {
        addTab(tab);
      }
      // Resolve pending connect call for this session
      const session = getSession(sessionId);
      if (session?.pendingConnect) {
        session.connectInProgress = false;
        clearTimeout(session.pendingConnect.timeout);
        session.pendingConnect.resolve({
          name: message.browser.name,
          version: message.browser.version,
          tabCount: message.tabs.length,
        });
        session.pendingConnect = null;
      }
      break;
    }

    case "disconnected":
      setConnected(false);
      break;

    case "tabCreated": {
      addTab(message.tab);
      // Resolve pending openTab call if requestId matches
      if (message.requestId) {
        const reqSessionId = extractSessionIdFromCallId(message.requestId) ?? sessionId;
        const session = getSession(reqSessionId);
        if (session) {
          const pending = session.pendingOpenTabs.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            session.pendingOpenTabs.delete(message.requestId);
            pending.resolve(message.tab);
          }
        }
      }
      break;
    }

    case "tabUpdated":
      updateTab(message.tab);
      break;

    case "tabClosed": {
      removeTab(message.tabId);
      // Check all sessions for pending close operation
      for (const session of getAllSessions()) {
        const pending = session.pendingCloseTabs.get(message.tabId);
        if (pending) {
          clearTimeout(pending.timeout);
          session.pendingCloseTabs.delete(message.tabId);
          pending.resolve(undefined);
          break; // Only one session should be waiting for this close
        }
      }
      break;
    }

    case "toolsChanged":
      updateTabTools(message.tabId, message.tools);
      break;

    case "tabFocused": {
      updateTabTools(message.tabId, message.tools);
      // Resolve pending openTab if requestId matches
      if (message.requestId) {
        const reqSessionId = extractSessionIdFromCallId(message.requestId) ?? sessionId;
        const session = getSession(reqSessionId);
        if (session) {
          const pending = session.pendingOpenTabs.get(message.requestId);
          if (pending) {
            const tab = getState().tabs.get(message.tabId);
            if (tab) {
              clearTimeout(pending.timeout);
              session.pendingOpenTabs.delete(message.requestId);
              pending.resolve(tab);
            }
          }
        }
      }
      break;
    }

    case "toolsDiscovered": {
      const discoverSessionId = extractSessionIdFromCallId(message.callId) ?? sessionId;
      const session = getSession(discoverSessionId);
      if (session) {
        const pending = session.pendingCalls.get(message.callId);
        if (pending) {
          session.pendingCalls.delete(message.callId);
          updateTabTools(message.tabId, message.tools);
          pending.resolve(message.tools);
        }
      }
      break;
    }

    case "toolResult": {
      const resultSessionId = extractSessionIdFromCallId(message.callId) ?? sessionId;
      const session = getSession(resultSessionId);
      if (session) {
        const pending = session.pendingCalls.get(message.callId);
        if (pending) {
          session.pendingCalls.delete(message.callId);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
        }
      }
      break;
    }
  }
}

/**
 * Called when connect action is invoked.
 * Sends a connect message to the extension and waits for response.
 */
export function connectToExtension(
  sessionId: string = DEFAULT_SESSION_ID
): Promise<{ name: string; version: string; tabCount: number }> {
  return new Promise((resolve, reject) => {
    const session = getOrCreateSession(sessionId);

    if (session.connectInProgress) {
      reject(new Error("Connection already in progress"));
      return;
    }

    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
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

    send({ type: "connect", sessionId });
  });
}

function send(message: ServerMessage): void {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Extension not connected");
  }
  extensionSocket.send(JSON.stringify(message));
}

export function isConnected(): boolean {
  return extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;
}

export function getActivePort(): number | null {
  return activePort;
}

export async function openTab(
  url: string,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<TabInfo> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
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

    // Always focus so we wait for page load and get tools
    send({ type: "openTab", sessionId, url, focus: true, requestId });
  });
}

export async function closeTab(
  tabId: number,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);

    // Reject if already closing this tab (within this session)
    if (session.pendingCloseTabs.has(tabId)) {
      reject(new Error(`Already closing tab ${tabId}`));
      return;
    }

    const timeout = setTimeout(() => {
      session.pendingCloseTabs.delete(tabId);
      reject(new Error("Timeout waiting for tab close"));
    }, 5000);

    session.pendingCloseTabs.set(tabId, { resolve, reject, timeout });
    send({ type: "closeTab", sessionId, tabId });
  });
}

export async function callPageTool(
  tabId: number,
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string = DEFAULT_SESSION_ID
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);
    const callId = generateCallId(session, "call");
    session.pendingCalls.set(callId, { resolve, reject });

    send({ type: "callTool", sessionId, callId, tabId, toolName, args });

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
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const session = getOrCreateSession(sessionId);
    const callId = generateCallId(session, "discover");
    session.pendingCalls.set(callId, { resolve, reject });

    send({ type: "discoverTools", sessionId, callId, tabId });

    setTimeout(() => {
      if (session.pendingCalls.has(callId)) {
        session.pendingCalls.delete(callId);
        reject(new Error("Timeout waiting for tool discovery"));
      }
    }, 10000);
  });
}
