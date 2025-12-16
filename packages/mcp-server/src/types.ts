import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  tools: Tool[];
}

export interface BrowserState {
  connected: boolean;
  focusedTabId: number | null;
  tabs: Map<number, TabInfo>;
  browserInfo: { name: string; version: string } | null;
}

// Messages from extension to MCP server
export type ExtensionMessage =
  | { type: "connected"; browser: { name: string; version: string }; tabs: TabInfo[] }
  | { type: "disconnected" }
  | { type: "tabCreated"; tab: TabInfo }
  | { type: "tabUpdated"; tab: TabInfo }
  | { type: "tabClosed"; tabId: number }
  | { type: "tabFocused"; tabId: number; tools: Tool[] }
  | { type: "toolsChanged"; tabId: number; tools: Tool[] }
  | { type: "toolResult"; callId: string; result: unknown; error?: string };

// Messages from MCP server to extension
export type ServerMessage =
  | { type: "connect"; launch?: boolean }
  | { type: "openTab"; url: string; focus: boolean }
  | { type: "focusTab"; tabId: number }
  | { type: "closeTab"; tabId: number }
  | { type: "callTool"; callId: string; tabId: number; toolName: string; args: Record<string, unknown> };
