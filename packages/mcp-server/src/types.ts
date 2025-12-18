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
  | { type: "connected"; sessionId?: string; browser: { name: string; version: string }; tabs: TabInfo[] }
  | { type: "disconnected"; sessionId?: string }
  | { type: "tabCreated"; sessionId?: string; tab: TabInfo; requestId?: string }
  | { type: "tabUpdated"; sessionId?: string; tab: TabInfo }
  | { type: "tabClosed"; sessionId?: string; tabId: number }
  | { type: "toolsChanged"; sessionId?: string; tabId: number; tools: Tool[] }
  | { type: "toolResult"; sessionId?: string; callId: string; result: unknown; error?: string }
  | { type: "toolsDiscovered"; sessionId?: string; callId: string; tabId: number; tools: Tool[] }
  | { type: "tabFocused"; sessionId?: string; tabId: number; tools: Tool[]; requestId?: string }
  | { type: "ping" }
  | { type: "pong" };

// Messages from MCP server to extension
export type ServerMessage =
  | { type: "connect"; sessionId?: string; launch?: boolean }
  | { type: "openTab"; sessionId?: string; url: string; focus: boolean; requestId?: string }
  | { type: "closeTab"; sessionId?: string; tabId: number }
  | { type: "callTool"; sessionId?: string; callId: string; tabId: number; toolName: string; args: Record<string, unknown> }
  | { type: "discoverTools"; sessionId?: string; callId: string; tabId: number }
  | { type: "pong" };

  