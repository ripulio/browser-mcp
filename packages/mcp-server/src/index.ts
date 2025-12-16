#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getTools } from "./tools.js";
import { getState, clearFocus } from "./state.js";
import {
  connectToExtension,
  startServer,
  openTab,
  focusTab,
  closeTab,
  callPageTool,
} from "./extension-client.js";

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

  try {
    const result = await handleTool(name, args as Record<string, unknown> ?? {});
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

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const state = getState();

  switch (name) {
    case "connect_browser": {
      const result = await connectToExtension();
      return {
        connected: true,
        browser: { name: result.name, version: result.version },
        tabCount: result.tabCount,
      };
    }

    case "list_tabs": {
      if (!state.connected) {
        throw new Error("Not connected. Call connect_browser first.");
      }
      const tabs = Array.from(state.tabs.values()).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        focused: tab.id === state.focusedTabId,
        toolCount: tab.tools.length,
      }));
      return { tabs, focusedTabId: state.focusedTabId };
    }

    case "open_tab": {
      if (!state.connected) {
        throw new Error("Not connected. Call connect_browser first.");
      }
      const url = args.url as string;
      const focus = (args.focus as boolean) ?? true;
      if (!url) {
        throw new Error("url is required");
      }
      const tab = await openTab(url, focus);
      return {
        tab: { id: tab.id, title: tab.title, url: tab.url },
        focused: focus,
        toolsAvailable: focus ? tab.tools.map((t) => t.name) : [],
      };
    }

    case "focus_tab": {
      if (!state.connected) {
        throw new Error("Not connected. Call connect_browser first.");
      }
      const tabId = args.tabId as number;
      if (tabId === undefined) {
        throw new Error("tabId is required");
      }
      if (!state.tabs.has(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      await focusTab(tabId);
      const tab = state.tabs.get(tabId)!;
      return {
        success: true,
        tab: { id: tab.id, title: tab.title, url: tab.url },
        toolsAvailable: tab.tools.map((t) => t.name),
      };
    }

    case "close_tab": {
      if (!state.connected) {
        throw new Error("Not connected. Call connect_browser first.");
      }
      const tabId = (args.tabId as number) ?? state.focusedTabId;
      if (tabId === null) {
        throw new Error("No tab specified and no tab is focused");
      }
      if (!state.tabs.has(tabId)) {
        throw new Error(`Tab ${tabId} not found`);
      }
      const wasClosingFocusedTab = tabId === state.focusedTabId;
      await closeTab(tabId);
      if (wasClosingFocusedTab) {
        clearFocus();
      }
      return { closed: true, tabId };
    }

    default: {
      // Assume it's a page-specific tool
      if (!state.connected) {
        throw new Error("Not connected. Call connect_browser first.");
      }
      if (state.focusedTabId === null) {
        throw new Error("No tab is focused. Call focus_tab first.");
      }
      const result = await callPageTool(state.focusedTabId, name, args);
      return result;
    }
  }
}

// Start the server
async function main() {
  // Start WebSocket server for extension connections
  startServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Browser MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
