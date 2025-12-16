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

const WS_PORT = 8765;

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
const pendingCalls = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
let callIdCounter = 0;

// Pending connect call waiting for extension
let connectInProgress = false;
let pendingConnect: {
  resolve: (result: { name: string; version: string; tabCount: number }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
} | null = null;

// Pending openTab calls waiting for tabCreated/tabFocused
const pendingOpenTabs = new Map<string, {
  resolve: (tab: TabInfo) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

// Pending closeTab calls waiting for tabClosed
const pendingCloseTabs = new Map<number, {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

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
      let message: ExtensionMessage | { type: "ping" };
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

      handleExtensionMessage(message as ExtensionMessage);
    });

    socket.on("close", () => {
      console.error("Extension disconnected");
      extensionSocket = null;
      setConnected(false);

      // Clean up pending calls (timeouts will self-clean when they check the map)
      for (const [id, pending] of pendingCalls) {
        pending.reject(new Error("Connection closed"));
      }
      pendingCalls.clear();

      // Clean up pending open tabs
      for (const [id, pending] of pendingOpenTabs) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Connection closed"));
      }
      pendingOpenTabs.clear();

      // Clean up pending close tabs
      for (const [id, pending] of pendingCloseTabs) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Connection closed"));
      }
      pendingCloseTabs.clear();

      // Clean up pending connect
      if (pendingConnect) {
        connectInProgress = false;
        clearTimeout(pendingConnect.timeout);
        pendingConnect.reject(new Error("Connection closed"));
        pendingConnect = null;
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

function handleExtensionMessage(message: ExtensionMessage): void {
  switch (message.type) {
    case "connected":
      setConnected(true, message.browser);
      for (const tab of message.tabs) {
        addTab(tab);
      }
      // Resolve pending connect call
      if (pendingConnect) {
        connectInProgress = false;
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

    case "tabCreated": {
      addTab(message.tab);
      // Resolve pending openTab call if requestId matches
      if (message.requestId) {
        const pending = pendingOpenTabs.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingOpenTabs.delete(message.requestId);
          pending.resolve(message.tab);
        }
      }
      break;
    }

    case "tabUpdated":
      updateTab(message.tab);
      break;

    case "tabClosed": {
      removeTab(message.tabId);
      const pending = pendingCloseTabs.get(message.tabId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingCloseTabs.delete(message.tabId);
        pending.resolve();
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
        const pending = pendingOpenTabs.get(message.requestId);
        if (pending) {
          const tab = getState().tabs.get(message.tabId);
          if (tab) {
            clearTimeout(pending.timeout);
            pendingOpenTabs.delete(message.requestId);
            pending.resolve(tab);
          }
        }
      }
      break;
    }

    case "toolsDiscovered": {
      const pending = pendingCalls.get(message.callId);
      if (pending) {
        pendingCalls.delete(message.callId);
        updateTabTools(message.tabId, message.tools);
        pending.resolve(message.tools);
      }
      break;
    }

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
    if (connectInProgress) {
      reject(new Error("Connection already in progress"));
      return;
    }

    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Extension not connected. Please ensure the browser extension is installed and enabled."));
      return;
    }

    connectInProgress = true;

    const timeout = setTimeout(() => {
      connectInProgress = false;
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

    const requestId = `open_${++callIdCounter}`;

    const timeout = setTimeout(() => {
      pendingOpenTabs.delete(requestId);
      reject(new Error("Timeout waiting for tab to open"));
    }, 30000);

    pendingOpenTabs.set(requestId, { resolve, reject, timeout });

    // Always focus so we wait for page load and get tools
    send({ type: "openTab", url, focus: true, requestId });
  });
}

export async function closeTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    // Reject if already closing this tab
    if (pendingCloseTabs.has(tabId)) {
      reject(new Error(`Already closing tab ${tabId}`));
      return;
    }

    const timeout = setTimeout(() => {
      pendingCloseTabs.delete(tabId);
      reject(new Error("Timeout waiting for tab close"));
    }, 5000);

    pendingCloseTabs.set(tabId, { resolve, reject, timeout });
    send({ type: "closeTab", tabId });
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

export async function discoverToolsForTab(tabId: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Not connected to browser"));
      return;
    }

    const callId = `discover_${++callIdCounter}`;
    pendingCalls.set(callId, { resolve, reject });

    send({ type: "discoverTools", callId, tabId });

    setTimeout(() => {
      if (pendingCalls.has(callId)) {
        pendingCalls.delete(callId);
        reject(new Error("Timeout waiting for tool discovery"));
      }
    }, 10000);
  });
}
