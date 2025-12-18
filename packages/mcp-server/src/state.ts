import { BrowserState, TabInfo } from "./types.js";

// Shared browser state - all sessions see the same browser/tabs
// (because there's only one browser with one set of tabs)
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
