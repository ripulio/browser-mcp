import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const connectBrowserTool: Tool = {
  name: "connect_browser",
  description: "Connect to the browser. Must be called first before any browser operations.",
  inputSchema: {
    type: "object",
    properties: {
      launch: {
        type: "boolean",
        description: "Launch new browser instance if none found",
        default: false,
      },
    },
  },
};

export const listTabsTool: Tool = {
  name: "list_tabs",
  description: "List all open browser tabs with their IDs, titles, and URLs",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export const openTabTool: Tool = {
  name: "open_tab",
  description: "Open a new browser tab with the specified URL",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to open",
      },
      focus: {
        type: "boolean",
        description: "Focus the new tab after opening (loads its tools)",
        default: true,
      },
    },
    required: ["url"],
  },
};

export const focusTabTool: Tool = {
  name: "focus_tab",
  description: "Switch focus to a different tab, loading its page-specific tools",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "ID of the tab to focus",
      },
    },
    required: ["tabId"],
  },
};

export const closeTabTool: Tool = {
  name: "close_tab",
  description: "Close a browser tab",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "ID of tab to close. Defaults to focused tab.",
      },
    },
  },
};

export function getTools(): Tool[] {
  return [
    connectBrowserTool,
    listTabsTool,
    openTabTool,
    focusTabTool,
    closeTabTool,
  ];
}
