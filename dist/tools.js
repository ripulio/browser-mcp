/**
 * Tool Definitions - MCP Tool Schema
 *
 * This module defines the MCP tools exposed by the server. Currently there
 * is a single "executeTool" tool that acts as a proxy for marshalling tool
 * calls to web pages via the browser extension.
 *
 * The executeTool uses an "action" parameter to dispatch to different
 * operations (connect, list_tabs, open_tab, close_tab) or to page-specific
 * tools exposed by web pages through navigator.modelContext.
 */
export const browserTool = {
    name: "executeTool",
    description: `Control the browser and execute page tools. Actions:
- list_tabs: List all open tabs with their available tools
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
export function getTools() {
    return [browserTool];
}
