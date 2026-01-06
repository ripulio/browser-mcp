#!/usr/bin/env node
/**
 * Browser MCP Server - Entry Point
 *
 * This is the main entry point for the Browser MCP server. It exposes a single
 * "executeTool" tool that proxies tool calls to web pages through the
 * Model Context Protocol (MCP).
 *
 * The server:
 * - Starts a WebSocket server for the Chrome extension to connect to
 * - Handles MCP tool requests via stdio transport
 * - Auto-connects to the extension on first action
 * - Routes browser actions: list_tabs, open_tab, close_tab
 * - Proxies page-specific tool calls to web pages via navigator.modelContext
 *
 * Architecture:
 * Claude Client <-> MCP (stdio) <-> This Server <-> WebSocket <-> Chrome Extension
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { getTools } from "./tools.js";
import { getState } from "./state.js";
import { connectToExtension, startServer, openTab, closeTab, callPageTool, discoverToolsForTab, DEFAULT_SESSION_ID, } from "./extension-client.js";
import { createSession, startSessionCleanup } from "./session.js";
// Auto-connect to extension if not already connected
async function ensureConnected() {
    const state = getState();
    if (!state.connected) {
        await connectToExtension(DEFAULT_SESSION_ID);
    }
}
// Handle tools/call requests
async function handleBrowserAction(action, params) {
    const state = getState();
    switch (action) {
        case "list_tabs": {
            await ensureConnected();
            // Discover tools for all tabs in parallel
            const tabIds = Array.from(state.tabs.keys());
            await Promise.all(tabIds.map((tabId) => discoverToolsForTab(tabId, DEFAULT_SESSION_ID).catch((err) => {
                console.error(`Failed to discover tools for tab ${tabId}:`, err.message);
                return [];
            })));
            // Return tabs with freshly discovered tools (including descriptions)
            const tabs = Array.from(state.tabs.values()).map((tab) => ({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                tools: tab.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                })),
            }));
            return { tabs };
        }
        case "open_tab": {
            await ensureConnected();
            const url = params.url;
            if (!url) {
                throw new Error("url parameter is required for open_tab");
            }
            const tab = await openTab(url, DEFAULT_SESSION_ID);
            return {
                tab: {
                    id: tab.id,
                    title: tab.title,
                    url: tab.url,
                    tools: tab.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    })),
                },
            };
        }
        case "close_tab": {
            await ensureConnected();
            const tabId = params.tabId;
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
            await ensureConnected();
            const tabId = params.tabId;
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
const server = new Server({
    name: "browser-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Handle tools/list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getTools() };
});
// Handle tools/call requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name !== "executeTool") {
        return {
            content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
            isError: true,
        };
    }
    const params = args ?? {};
    const action = params.action;
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
    }
    catch (error) {
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
