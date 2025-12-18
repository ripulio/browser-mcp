/**
 * Chrome Extension Background Service Worker
 *
 * This service worker manages WebSocket connections to MCP servers and
 * bridges browser automation requests. Key responsibilities:
 *
 * - Server Discovery: Scans ports 8765-8785 for available MCP servers
 * - Multi-Server Support: Maintains connections to ALL discovered servers
 * - Message Routing: Routes requests to specific servers, broadcasts events
 * - Tab Management: Opens, closes, focuses tabs on server request
 * - Tool Discovery: Queries navigator.modelContext for page-exposed tools
 * - Tool Execution: Executes page tools via userScripts API in MAIN world
 *
 * The extension connects to multiple MCP servers simultaneously, enabling
 * multiple Claude instances to control the same browser.
 */

import { ExtensionMessage, ServerMessage, TabInfo, Tool } from "./types.js";
import { ExtensionMessageType, ServerMessageType } from "./message-types.js";
import { discoverToolsScript, executeToolScript, toInjectedScript } from "./page-scripts.js";

const LOG_PREFIX = "[BrowserMCP]";
const WS_PORT_START = 8765;
const WS_PORT_END = 8785;
const KEEPALIVE_INTERVAL = 20 * 1000; // 20 seconds
const DISCOVERY_INTERVAL = 5 * 1000; // Check for new servers every 5 seconds

// Map of port -> WebSocket connection
const connections = new Map<number, WebSocket>();
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
let discoveryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Try to connect to a server on a specific port
 */
function connectToPort(port: number): void {
  if (connections.has(port)) {
    return; // Already connected or connecting
  }

  const ws = new WebSocket(`ws://localhost:${port}`);

  ws.onopen = () => {
    console.log(`${LOG_PREFIX} Connected to MCP server on port ${port}`);
    connections.set(port, ws);
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    handleServerMessage(message, port);
  };

  ws.onclose = () => {
    console.log(`${LOG_PREFIX} Disconnected from MCP server on port ${port}`);
    connections.delete(port);
  };

  ws.onerror = () => {
    // Silently ignore - server not available on this port
    connections.delete(port);
  };
}

/**
 * Scan for available servers on all ports in range
 */
function discoverServers(): void {
  for (let port = WS_PORT_START; port <= WS_PORT_END; port++) {
    if (!connections.has(port)) {
      connectToPort(port);
    }
  }
}

/**
 * Send a message to a specific server
 */
function sendToPort(port: number, message: ExtensionMessage): void {
  const ws = connections.get(port);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error(`${LOG_PREFIX} Cannot send to port ${port} - not connected`);
    return;
  }
  ws.send(JSON.stringify(message));
}

/**
 * Send a message to all connected servers (for broadcasts like tab events)
 */
function broadcast(message: ExtensionMessage): void {
  for (const [port, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

/**
 * Start the keepalive ping to prevent service worker from sleeping
 */
function startKeepalive(): void {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    broadcast({ type: ExtensionMessageType.PING });
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive(): void {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

/**
 * Start periodic server discovery
 */
function startDiscovery(): void {
  // Initial discovery
  discoverServers();

  // Periodic discovery for new servers
  discoveryInterval = setInterval(discoverServers, DISCOVERY_INTERVAL);
}

/**
 * Handle messages from an MCP server
 */
async function handleServerMessage(message: ServerMessage, sourcePort: number): Promise<void> {
  // Extract sessionId from message for passing through responses
  const sessionId = (message as { sessionId?: string }).sessionId;

  switch (message.type) {
    case ServerMessageType.PONG:
      // Keepalive response, nothing to do
      break;

    case ServerMessageType.CONNECT:
      await handleConnect(sourcePort, sessionId);
      break;

    case ServerMessageType.OPEN_TAB:
      await handleOpenTab(sourcePort, message.url, message.focus, message.requestId, sessionId);
      break;

    case ServerMessageType.FOCUS_TAB:
      await handleFocusTab(sourcePort, message.tabId, sessionId);
      break;

    case ServerMessageType.CLOSE_TAB:
      await handleCloseTab(sourcePort, message.tabId, sessionId);
      break;

    case ServerMessageType.CALL_TOOL:
      await handleCallTool(sourcePort, message.callId, message.tabId, message.toolName, message.args, sessionId);
      break;

    case ServerMessageType.DISCOVER_TOOLS:
      await handleDiscoverTools(sourcePort, message.callId, message.tabId, sessionId);
      break;
  }
}

/**
 * Handle connect request - send browser info and current tabs
 */
async function handleConnect(sourcePort: number, sessionId?: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const tabInfos: TabInfo[] = tabs
    .filter((tab) => tab.id !== undefined)
    .map((tab) => ({
      id: tab.id!,
      title: tab.title || "",
      url: tab.url || "",
      tools: [], // Tools are only populated when focused
    }));

  sendToPort(sourcePort, {
    type: ExtensionMessageType.CONNECTED,
    sessionId,
    browser: {
      name: "Chrome",
      version: navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || "unknown",
    },
    tabs: tabInfos,
  });
}

/**
 * Handle open tab request
 */
async function handleOpenTab(sourcePort: number, url: string, focus: boolean, requestId?: string, sessionId?: string): Promise<void> {
  const tab = await chrome.tabs.create({ url, active: focus });

  if (focus && tab.id) {
    // Wait for page to load, then get tools
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        sendTabFocused(sourcePort, tab.id!, requestId, sessionId);
      }
    });
  } else {
    sendToPort(sourcePort, {
      type: ExtensionMessageType.TAB_CREATED,
      sessionId,
      tab: {
        id: tab.id!,
        title: tab.title || "",
        url: tab.url || url,
        tools: [],
      },
      requestId,
    });
  }
}

/**
 * Handle focus tab request
 */
async function handleFocusTab(sourcePort: number, tabId: number, sessionId?: string): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await sendTabFocused(sourcePort, tabId, undefined, sessionId);
}

/**
 * Handle close tab request
 */
async function handleCloseTab(sourcePort: number, tabId: number, sessionId?: string): Promise<void> {
  await chrome.tabs.remove(tabId);
  sendToPort(sourcePort, { type: ExtensionMessageType.TAB_CLOSED, sessionId, tabId });
}

/**
 * Handle discover tools request - discover tools for a specific tab without focusing
 */
async function handleDiscoverTools(sourcePort: number, callId: string, tabId: number, sessionId?: string): Promise<void> {
  const tools = await discoverTools(tabId);
  sendToPort(sourcePort, {
    type: ExtensionMessageType.TOOLS_DISCOVERED,
    sessionId,
    callId,
    tabId,
    tools,
  });
}

/**
 * Handle tool call request by executing via navigator.modelContext
 */
async function handleCallTool(
  sourcePort: number,
  callId: string,
  tabId: number,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  console.log(`${LOG_PREFIX} Calling tool "${toolName}" on tab ${tabId} with args:`, args);

  try {
    const code = toInjectedScript(executeToolScript, toolName, args);

    console.log(`${LOG_PREFIX} Executing userScript on tab ${tabId}...`);
    const results = await chrome.userScripts.execute({
      target: { tabId },
      world: "MAIN",
      js: [{ code }],
    });
    console.log(`${LOG_PREFIX} userScript execution results:`, results);

    const response = results?.[0]?.result as { result?: unknown; error?: string } | undefined;
    console.log(`${LOG_PREFIX} Parsed response:`, response);

    if (response?.error) {
      console.error(`${LOG_PREFIX} Tool error:`, response.error);
      sendToPort(sourcePort, {
        type: ExtensionMessageType.TOOL_RESULT,
        sessionId,
        callId,
        result: null,
        error: response.error,
      });
    } else {
      console.log(`${LOG_PREFIX} Tool success, sending result:`, response?.result);
      sendToPort(sourcePort, {
        type: ExtensionMessageType.TOOL_RESULT,
        sessionId,
        callId,
        result: response?.result ?? null,
      });
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Tool call exception:`, error);
    sendToPort(sourcePort, {
      type: ExtensionMessageType.TOOL_RESULT,
      sessionId,
      callId,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send tab focused message with discovered tools
 */
async function sendTabFocused(sourcePort: number, tabId: number, requestId?: string, sessionId?: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const tools = await discoverTools(tabId);

  sendToPort(sourcePort, {
    type: ExtensionMessageType.TAB_FOCUSED,
    sessionId,
    tabId,
    tools,
    requestId,
  });
}

/**
 * Discover available tools for the current page by querying navigator.modelContext
 */
async function discoverTools(tabId: number): Promise<Tool[]> {
  try {
    // Get tab info to check URL
    const tab = await chrome.tabs.get(tabId);

    // Skip restricted URLs that we can't inject into
    if (!tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("about:") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("devtools://")) {
      return [];
    }

    const code = toInjectedScript(discoverToolsScript);

    const results = await chrome.userScripts.execute({
      target: { tabId },
      world: "MAIN",
      js: [{ code }],
    });

    if (results && results[0]?.result) {
      return results[0].result as Tool[];
    }
    return [];
  } catch (error) {
    // Silently return empty for permission errors on restricted pages
    return [];
  }
}

// Listen for tab events to keep MCP servers in sync
// Broadcast to all connected servers
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id && connections.size > 0) {
    broadcast({
      type: ExtensionMessageType.TAB_CREATED,
      tab: {
        id: tab.id,
        title: tab.title || "",
        url: tab.url || "",
        tools: [],
      },
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (connections.size > 0) {
    broadcast({ type: ExtensionMessageType.TAB_CLOSED, tabId });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (connections.size > 0 && (changeInfo.title || changeInfo.url)) {
    broadcast({
      type: ExtensionMessageType.TAB_UPDATED,
      tab: {
        id: tabId,
        title: tab.title || "",
        url: tab.url || "",
        tools: [],
      },
    });
  }
});

// Start discovery and keepalive when service worker loads
startDiscovery();
startKeepalive();

console.log(`${LOG_PREFIX} Service worker started - scanning for servers on ports`, WS_PORT_START, "-", WS_PORT_END);
