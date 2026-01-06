/**
 * Browser State - Shared State Management
 *
 * This module maintains the shared browser state that all sessions access.
 * Since there's only one browser with one set of tabs, this state is shared
 * across all MCP client sessions.
 *
 * State includes:
 * - Connection status (connected/disconnected)
 * - Browser info (name, version)
 * - Map of open tabs with their IDs, titles, URLs, and available tools
 *
 * Operations that modify individual tab state (add, update, remove, tools)
 * are performed here, while session-specific pending operations are tracked
 * separately in session.ts.
 */
import { BrowserState, TabInfo } from "./types.js";
export declare function getState(): BrowserState;
export declare function setConnected(connected: boolean, browserInfo?: {
    name: string;
    version: string;
}): void;
export declare function addTab(tab: TabInfo): void;
export declare function updateTab(tab: TabInfo): void;
export declare function removeTab(tabId: number): void;
export declare function updateTabTools(tabId: number, tools: import("@modelcontextprotocol/sdk/types.js").Tool[]): void;
export declare function isConnected(): boolean;
