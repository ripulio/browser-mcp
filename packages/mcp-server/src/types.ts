import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  tools: Tool[];
}

export interface BrowserState {
  connected: boolean;
  tabs: Map<number, TabInfo>;
  browserInfo: { name: string; version: string } | null;
}

// Messages from extension to MCP server
export type ExtensionMessage =
  | { type: "connected"; browser: { name: string; version: string }; tabs: TabInfo[] }
  | { type: "disconnected" }
  | { type: "tabCreated"; tab: TabInfo; requestId?: string }
  | { type: "tabUpdated"; tab: TabInfo }
  | { type: "tabClosed"; tabId: number }
  | { type: "toolsChanged"; tabId: number; tools: Tool[] }
  | { type: "toolResult"; callId: string; result: unknown; error?: string }
  | { type: "toolsDiscovered"; callId: string; tabId: number; tools: Tool[] }
  | { type: "tabFocused"; tabId: number; tools: Tool[]; requestId?: string };

// Messages from MCP server to extension
export type ServerMessage =
  | { type: "connect"; launch?: boolean }
  | { type: "openTab"; url: string; focus: boolean; requestId?: string }
  | { type: "closeTab"; tabId: number }
  | { type: "callTool"; callId: string; tabId: number; toolName: string; args: Record<string, unknown> }
  | { type: "discoverTools"; callId: string; tabId: number };
