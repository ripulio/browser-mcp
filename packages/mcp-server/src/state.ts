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
function createInitialState(): BrowserState {
  return {
    connected: false,
    tabs: new Map(),
    browserInfo: null,
  };
}

// Singleton shared state
const sharedState = createInitialState();

export function getState(): BrowserState {
  return sharedState;
}

export function setConnected(
  connected: boolean,
  browserInfo?: { name: string; version: string }
): void {
  sharedState.connected = connected;
  sharedState.browserInfo = browserInfo ?? null;
  if (!connected) {
    sharedState.tabs.clear();
  }
}

export function addTab(tab: TabInfo): void {
  sharedState.tabs.set(tab.id, tab);
}

export function updateTab(tab: TabInfo): void {
  sharedState.tabs.set(tab.id, tab);
}

export function removeTab(tabId: number): void {
  sharedState.tabs.delete(tabId);
}

export function updateTabTools(tabId: number, tools: import("@modelcontextprotocol/sdk/types.js").Tool[]): void {
  const tab = sharedState.tabs.get(tabId);
  if (tab) {
    tab.tools = tools;
  }
}

export function isConnected(): boolean {
  return sharedState.connected;
}
