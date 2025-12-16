import { BrowserState, TabInfo } from "./types.js";

export function createInitialState(): BrowserState {
  return {
    connected: false,
    focusedTabId: null,
    tabs: new Map(),
    browserInfo: null,
  };
}

export function getState(): BrowserState {
  return state;
}

export function setConnected(
  connected: boolean,
  browserInfo?: { name: string; version: string }
): void {
  state.connected = connected;
  state.browserInfo = browserInfo ?? null;
  if (!connected) {
    state.tabs.clear();
    state.focusedTabId = null;
  }
}

export function addTab(tab: TabInfo): void {
  state.tabs.set(tab.id, tab);
}

export function updateTab(tab: TabInfo): void {
  state.tabs.set(tab.id, tab);
}

export function removeTab(tabId: number): void {
  state.tabs.delete(tabId);
  if (state.focusedTabId === tabId) {
    state.focusedTabId = null;
  }
}

export function setFocusedTab(tabId: number, tools: import("@modelcontextprotocol/sdk/types.js").Tool[]): void {
  const tab = state.tabs.get(tabId);
  if (tab) {
    tab.tools = tools;
    state.focusedTabId = tabId;
  }
}

export function clearFocus(): void {
  state.focusedTabId = null;
}

export function updateTabTools(tabId: number, tools: import("@modelcontextprotocol/sdk/types.js").Tool[]): void {
  const tab = state.tabs.get(tabId);
  if (tab) {
    tab.tools = tools;
  }
}

const state = createInitialState();
