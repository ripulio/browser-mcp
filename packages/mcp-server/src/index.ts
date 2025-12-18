#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getTools } from "./tools.js";
import { getState } from "./state.js";
import {
  connectToExtension,
  startServer,
  openTab,
  closeTab,
  callPageTool,
  discoverToolsForTab,
  DEFAULT_SESSION_ID,
} from "./extension-client.js";
import { createSession, startSessionCleanup } from "./session.js";

// Handle tools/call requests
async function handleBrowserAction(
  action: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const state = getState();

  switch (action) {
    case "connect": {
      const result = await connectToExtension(DEFAULT_SESSION_ID);
      return {
        connected: true,
        browser: { name: result.name, version: result.version },
        tabCount: result.tabCount,
      };
    }

    case "list_tabs": {
      if (!state.connected) {
        throw new Error("Not connected. Use action: 'connect' first.");
      }
      // Discover tools for all tabs in parallel
      const tabIds = Array.from(state.tabs.keys());
      await Promise.all(
        tabIds.map((tabId) =>
          discoverToolsForTab(tabId, DEFAULT_SESSION_ID).catch((err) => {
            console.error(`Failed to discover tools for tab ${tabId}:`, err.message);
            return [];
          })
        )
      );
      // Return tabs with freshly discovered tools
      const tabs = Array.from(state.tabs.values()).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        tools: tab.tools.map((t) => t.name),
      }));
      return { tabs };
    }

    case "open_tab": {
      if (!state.connected) {
        throw new Error("Not connected. Use action: 'connect' first.");
      }
      const url = params.url as string;
      if (!url) {
        throw new Error("url parameter is required for open_tab");
      }
      const tab = await openTab(url, DEFAULT_SESSION_ID);
      return {
        tab: {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          tools: tab.tools.map((t) => t.name),
        },
      };
    }

    case "close_tab": {
      if (!state.connected) {
        throw new Error("Not connected. Use action: 'connect' first.");
      }
      const tabId = params.tabId as number;
      if (tabId === undefined) {
        throw new Error("tabId parameter is required for close_tab");
      }
      if (!state.tabs.has(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      await closeTab(tabId, DEFAULT_SESSION_ID);
      return { closed: true, tabId };
    }

    default: {
      // Assume it's a page-specific tool
      if (!state.connected) {
        throw new Error("Not connected. Use action: 'connect' first.");
      }
      const tabId = params.tabId as number;
      if (tabId === undefined) {
        throw new Error("tabId parameter is required for page-specific tools");
      }
      if (!state.tabs.has(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      // Pass all params except action and tabId to the page tool
      const { action: _, tabId: __, ...toolArgs } = params;
      const result = await callPageTool(tabId, action, toolArgs, DEFAULT_SESSION_ID);
      return result;
    }
  }
}

const server = new Server(
  {
    name: "browser-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tools/list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: getTools() };
});

// Handle tools/call requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== "browser") {
    return {
      content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const params = (args as Record<string, unknown>) ?? {};
  const action = params.action as string;

  if (!action) {
    return {
      content: [{ type: "text", text: "Error: action parameter is required" }],
      isError: true,
    };
  }

  try {
    const result = await handleBrowserAction(action, params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  // Start WebSocket server for extension connections
  await startServer();

  // Start session cleanup
  startSessionCleanup();

  // Create default session
  createSession(DEFAULT_SESSION_ID);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Browser MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
