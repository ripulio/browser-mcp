/**
 * Extension Client - Public API
 *
 * This module provides the public interface for interacting with the browser
 * extension. It exposes high-level functions for browser automation:
 * - connectToExtension: Establish connection and get browser info
 * - openTab: Open a new browser tab
 * - closeTab: Close an existing tab
 * - callPageTool: Execute a tool exposed by a web page
 * - discoverToolsForTab: Discover available tools on a tab
 *
 * All operations are session-aware to support multiple concurrent MCP clients.
 * This module delegates WebSocket communication to ws-server.ts and message
 * handling to message-handler.ts.
 */
import { TabInfo } from "./types.js";
import { startServer as startWsServer, getActivePort as getWsActivePort } from "./ws-server.js";
export declare const DEFAULT_SESSION_ID = "default";
export declare const startServer: typeof startWsServer;
export declare const getActivePort: typeof getWsActivePort;
export declare function isConnected(): boolean;
export declare function connectToExtension(sessionId?: string): Promise<{
    name: string;
    version: string;
    tabCount: number;
}>;
export declare function openTab(url: string, sessionId?: string): Promise<TabInfo>;
export declare function closeTab(tabId: number, sessionId?: string): Promise<void>;
export declare function callPageTool(tabId: number, toolName: string, args: Record<string, unknown>, sessionId?: string): Promise<unknown>;
export declare function discoverToolsForTab(tabId: number, sessionId?: string): Promise<unknown>;
