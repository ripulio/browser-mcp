import { ExtensionMessage, ServerMessage, TabInfo, Tool } from "./types.js";

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
    console.log(`[BrowserMCP] Connected to MCP server on port ${port}`);
    connections.set(port, ws);
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    handleServerMessage(message, port);
  };

  ws.onclose = () => {
    console.log(`[BrowserMCP] Disconnected from MCP server on port ${port}`);
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
    console.error(`[BrowserMCP] Cannot send to port ${port} - not connected`);
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
    broadcast({ type: "ping" });
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
    case "pong":
      // Keepalive response, nothing to do
      break;

    case "connect":
      await handleConnect(sourcePort, sessionId);
      break;

    case "openTab":
      await handleOpenTab(sourcePort, message.url, message.focus, message.requestId, sessionId);
      break;

    case "focusTab":
      await handleFocusTab(sourcePort, message.tabId, sessionId);
      break;

    case "closeTab":
      await handleCloseTab(sourcePort, message.tabId, sessionId);
      break;

    case "callTool":
      await handleCallTool(sourcePort, message.callId, message.tabId, message.toolName, message.args, sessionId);
      break;

    case "discoverTools":
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
    type: "connected",
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
      type: "tabCreated",
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
  sendToPort(sourcePort, { type: "tabClosed", sessionId, tabId });
}

/**
 * Handle discover tools request - discover tools for a specific tab without focusing
 */
async function handleDiscoverTools(sourcePort: number, callId: string, tabId: number, sessionId?: string): Promise<void> {
  const tools = await discoverTools(tabId);
  sendToPort(sourcePort, {
    type: "toolsDiscovered",
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
  console.log(`[BrowserMCP] Calling tool "${toolName}" on tab ${tabId} with args:`, args);

  try {
    const code = `
      (async () => {
        const toolName = ${JSON.stringify(toolName)};
        const toolArgs = ${JSON.stringify(args)};

        console.log('[BrowserMCP Page] Executing tool:', toolName, 'with args:', toolArgs);

        if (!navigator.modelContext || !navigator.modelContext.executeTool) {
          console.error('[BrowserMCP Page] navigator.modelContext not available');
          return { error: "navigator.modelContext not available" };
        }
        try {
          console.log('[BrowserMCP Page] Calling navigator.modelContext.executeTool...');
          const result = await navigator.modelContext.executeTool(toolName, toolArgs);
          console.log('[BrowserMCP Page] Tool result:', result);
          return { result };
        } catch (e) {
          console.error('[BrowserMCP Page] Tool execution error:', e);
          return { error: e instanceof Error ? e.message : String(e) };
        }
      })();
    `;

    console.log(`[BrowserMCP] Executing userScript on tab ${tabId}...`);
    const results = await chrome.userScripts.execute({
      target: { tabId },
      world: "MAIN",
      js: [{ code }],
    });
    console.log(`[BrowserMCP] userScript execution results:`, results);

    const response = results?.[0]?.result as { result?: unknown; error?: string } | undefined;
    console.log(`[BrowserMCP] Parsed response:`, response);

    if (response?.error) {
      console.error(`[BrowserMCP] Tool error:`, response.error);
      sendToPort(sourcePort, {
        type: "toolResult",
        sessionId,
        callId,
        result: null,
        error: response.error,
      });
    } else {
      console.log(`[BrowserMCP] Tool success, sending result:`, response?.result);
      sendToPort(sourcePort, {
        type: "toolResult",
        sessionId,
        callId,
        result: response?.result ?? null,
      });
    }
  } catch (error) {
    console.error(`[BrowserMCP] Tool call exception:`, error);
    sendToPort(sourcePort, {
      type: "toolResult",
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
    type: "tabFocused",
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

    const code = `
      (() => {
        if (!navigator.modelContext || !navigator.modelContext.list) {
          return [];
        }
        return [...navigator.modelContext.list()];
      })();
    `;

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
  if (connections.size > 0) {
    broadcast({ type: "tabClosed", tabId });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (connections.size > 0 && (changeInfo.title || changeInfo.url)) {
    broadcast({
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

// Start discovery and keepalive when service worker loads
startDiscovery();
startKeepalive();

console.log("[BrowserMCP] Service worker started - scanning for servers on ports", WS_PORT_START, "-", WS_PORT_END);
