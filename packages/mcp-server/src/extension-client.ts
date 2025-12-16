import { WebSocketServer, WebSocket } from "ws";
import { ExtensionMessage, ServerMessage, TabInfo } from "./types.js";
import {
  setConnected,
  addTab,
  updateTab,
  removeTab,
  updateTabTools,
} from "./state.js";

const WS_PORT = 8765;

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
const pendingCalls = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
let callIdCounter = 0;

// Pending connect call waiting for extension
let pendingConnect: {
  resolve: (result: { name: string; version: string; tabCount: number }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
} | null = null;

// Pending openTab call waiting for tabCreated
let pendingOpenTab: {
  resolve: (tab: TabInfo) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
} | null = null;

/**
 * Start the WebSocket server. Called once when MCP server starts.
 */
export function startServer(): void {
  if (wss) return;

  wss = new WebSocketServer({ port: WS_PORT });
  console.error(`WebSocket server listening on ws://localhost:${WS_PORT}`);

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
      const message = JSON.parse(data.toString()) as ExtensionMessage | { type: "ping" };

      // Handle keepalive pings
      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      handleExtensionMessage(message as ExtensionMessage);
    });

    socket.on("close", () => {
      console.error("Extension disconnected");
      extensionSocket = null;
      setConnected(false);
    });

    socket.on("error", (error) => {
      console.error("Extension socket error:", error.message);
    });
  });

  wss.on("error", (error) => {
    console.error("WebSocket server error:", error.message);
  });
}

function handleExtensionMessage(message: ExtensionMessage): void {
  switch (message.type) {
    case "connected":
      setConnected(true, message.browser);
      for (const tab of message.tabs) {
        addTab(tab);
      }
      // Resolve pending connect call
      if (pendingConnect) {
        clearTimeout(pendingConnect.timeout);
        pendingConnect.resolve({
          name: message.browser.name,
          version: message.browser.version,
          tabCount: message.tabs.length,
        });
        pendingConnect = null;
      }
      break;

    case "disconnected":
      setConnected(false);
      break;

    case "tabCreated":
      addTab(message.tab);
      // Resolve pending openTab call
      if (pendingOpenTab) {
        clearTimeout(pendingOpenTab.timeout);
        pendingOpenTab.resolve(message.tab);
        pendingOpenTab = null;
      }
      break;

    case "tabUpdated":
      updateTab(message.tab);
      break;

    case "tabClosed":
      removeTab(message.tabId);
      break;

    case "toolsChanged":
      updateTabTools(message.tabId, message.tools);
      break;

    case "toolResult": {
      const pending = pendingCalls.get(message.callId);
      if (pending) {
        pendingCalls.delete(message.callId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
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
export function connectToExtension(): Promise<{ name: string; version: string; tabCount: number }> {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Extension not connected. Please ensure the browser extension is installed and enabled."));
      return;
    }

    const timeout = setTimeout(() => {
      pendingConnect = null;
      reject(new Error("Connection timeout - extension did not respond"));
    }, 5000);

    pendingConnect = { resolve, reject, timeout };

    send({ type: "connect" });
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

export async function openTab(url: string): Promise<TabInfo> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const timeout = setTimeout(() => {
      pendingOpenTab = null;
      reject(new Error("Timeout waiting for tab to open"));
    }, 30000);

    pendingOpenTab = { resolve, reject, timeout };

    send({ type: "openTab", url });
  });
}

export async function closeTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    send({ type: "closeTab", tabId });

    const callId = `close_${++callIdCounter}`;
    pendingCalls.set(callId, { resolve: () => resolve(), reject });

    setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new Error("Timeout waiting for tab close"));
    }, 5000);
  });
}

export async function callPageTool(
  tabId: number,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const callId = `call_${++callIdCounter}`;
    pendingCalls.set(callId, { resolve, reject });

    send({ type: "callTool", callId, tabId, toolName, args });

    setTimeout(() => {
      if (pendingCalls.has(callId)) {
        pendingCalls.delete(callId);
        reject(new Error("Timeout waiting for tool result"));
      }
    }, 30000);
  });
}
