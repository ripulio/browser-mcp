// Messages from extension to MCP server
export type ExtensionMessage =
  | { type: "ping" }
  | { type: "connected"; sessionId?: string; browser: { name: string; version: string }; tabs: TabInfo[] }
  | { type: "disconnected"; sessionId?: string }
  | { type: "tabCreated"; sessionId?: string; tab: TabInfo; requestId?: string }
  | { type: "tabUpdated"; sessionId?: string; tab: TabInfo }
  | { type: "tabClosed"; sessionId?: string; tabId: number }
  | { type: "tabFocused"; sessionId?: string; tabId: number; tools: Tool[]; requestId?: string }
  | { type: "toolsChanged"; sessionId?: string; tabId: number; tools: Tool[] }
  | { type: "toolResult"; sessionId?: string; callId: string; result: unknown; error?: string }
  | { type: "toolsDiscovered"; sessionId?: string; callId: string; tabId: number; tools: Tool[] };

// Messages from MCP server to extension
export type ServerMessage =
  | { type: "pong" }
  | { type: "connect"; sessionId?: string; launch?: boolean }
  | { type: "openTab"; sessionId?: string; url: string; focus: boolean; requestId?: string }
  | { type: "focusTab"; sessionId?: string; tabId: number }
  | { type: "closeTab"; sessionId?: string; tabId: number }
  | { type: "callTool"; sessionId?: string; callId: string; tabId: number; toolName: string; args: Record<string, unknown> }
  | { type: "discoverTools"; sessionId?: string; callId: string; tabId: number };

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  tools: Tool[];
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
