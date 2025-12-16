// Messages from extension to MCP server
export type ExtensionMessage =
  | { type: "ping" }
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
  | { type: "pong" }
  | { type: "connect"; launch?: boolean }
  | { type: "openTab"; url: string; focus: boolean }
  | { type: "focusTab"; tabId: number }
  | { type: "closeTab"; tabId: number }
  | { type: "callTool"; callId: string; tabId: number; toolName: string; args: Record<string, unknown> };

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
