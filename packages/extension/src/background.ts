import { ExtensionMessage, ServerMessage, TabInfo, Tool } from "./types.js";

const WS_URL = "ws://localhost:8765";
const KEEPALIVE_INTERVAL = 20 * 1000; // 20 seconds

let ws: WebSocket | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Connect to the MCP server's WebSocket
 */
function connect(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("[BrowserMCP] Already connected");
    return;
  }

  console.log(`[BrowserMCP] Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[BrowserMCP] Connected to MCP server");
    startKeepalive();
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    handleServerMessage(message);
  };

  ws.onclose = () => {
    console.log("[BrowserMCP] Disconnected from MCP server");
    stopKeepalive();
    ws = null;
    // Attempt to reconnect after a delay
    setTimeout(connect, 5000);
  };

  ws.onerror = (error) => {
    console.error("[BrowserMCP] WebSocket error:", error);
  };
}

/**
 * Send a message to the MCP server
 */
function send(message: ExtensionMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error("[BrowserMCP] Cannot send - not connected");
    return;
  }
  ws.send(JSON.stringify(message));
}

/**
 * Start the keepalive ping to prevent service worker from sleeping
 */
function startKeepalive(): void {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    send({ type: "ping" });
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive(): void {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

/**
 * Handle messages from the MCP server
 */
async function handleServerMessage(message: ServerMessage): Promise<void> {
  switch (message.type) {
    case "pong":
      // Keepalive response, nothing to do
      break;

    case "connect":
      await handleConnect();
      break;

    case "openTab":
      await handleOpenTab(message.url, message.focus);
      break;

    case "focusTab":
      await handleFocusTab(message.tabId);
      break;

    case "closeTab":
      await handleCloseTab(message.tabId);
      break;

    case "callTool":
      await handleCallTool(message.callId, message.tabId, message.toolName, message.args);
      break;
  }
}

/**
 * Handle connect request - send browser info and current tabs
 */
async function handleConnect(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const tabInfos: TabInfo[] = tabs
    .filter((tab) => tab.id !== undefined)
    .map((tab) => ({
      id: tab.id!,
      title: tab.title || "",
      url: tab.url || "",
      tools: [], // Tools are only populated when focused
    }));

  send({
    type: "connected",
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
async function handleOpenTab(url: string, focus: boolean): Promise<void> {
  const tab = await chrome.tabs.create({ url, active: focus });

  if (focus && tab.id) {
    // Wait for page to load, then get tools
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        sendTabFocused(tab.id!);
      }
    });
  } else {
    send({
      type: "tabCreated",
      tab: {
        id: tab.id!,
        title: tab.title || "",
        url: tab.url || url,
        tools: [],
      },
    });
  }
}

/**
 * Handle focus tab request
 */
async function handleFocusTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await sendTabFocused(tabId);
}

/**
 * Handle close tab request
 */
async function handleCloseTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
  send({ type: "tabClosed", tabId });
}

/**
 * Handle tool call request
 */
async function handleCallTool(
  callId: string,
  tabId: number,
  toolName: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    // For now, just return an error - tool execution will be implemented later
    send({
      type: "toolResult",
      callId,
      result: null,
      error: `Tool execution not yet implemented: ${toolName}`,
    });
  } catch (error) {
    send({
      type: "toolResult",
      callId,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send tab focused message with discovered tools
 */
async function sendTabFocused(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const tools = await discoverTools(tabId);

  send({
    type: "tabFocused",
    tabId,
    tools,
  });
}

/**
 * Discover available tools for the current page
 * This is a placeholder - real implementation would analyze the DOM
 */
async function discoverTools(tabId: number): Promise<Tool[]> {
  // For now, return empty tools
  // Future: inject content script to analyze page and discover interactive elements
  return [];
}

// Listen for tab events to keep MCP server in sync
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id && ws?.readyState === WebSocket.OPEN) {
    send({
      type: "tabCreated",
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
  if (ws?.readyState === WebSocket.OPEN) {
    send({ type: "tabClosed", tabId });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (ws?.readyState === WebSocket.OPEN && (changeInfo.title || changeInfo.url)) {
    send({
      type: "tabUpdated",
      tab: {
        id: tabId,
        title: tab.title || "",
        url: tab.url || "",
        tools: [],
      },
    });
  }
});

// Start connection when service worker loads
connect();

console.log("[BrowserMCP] Service worker started");
