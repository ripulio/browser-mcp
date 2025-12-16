import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const browserTool: Tool = {
  name: "browser",
  description: `Control the browser. Actions:
- connect: Connect to browser extension (must be called first)
- list_tabs: List all tabs with their available tools
- open_tab: Open a new tab (params: url)
- close_tab: Close a tab (params: tabId)
- <tool_name>: Call a page-specific tool (params: tabId, plus tool-specific args)`,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The action to perform: connect, list_tabs, open_tab, close_tab, or a page-specific tool name",
      },
      tabId: {
        type: "number",
        description: "Tab ID (required for close_tab and page-specific tools)",
      },
      url: {
        type: "string",
        description: "URL to open (for open_tab action)",
      },
    },
    required: ["action"],
  },
};

export function getTools(): Tool[] {
  return [browserTool];
}
