/**
 * Type Definitions - Shared Types and Protocol Messages
 *
 * This module defines the TypeScript types used throughout the MCP server:
 * - TabInfo: Browser tab metadata including available page tools
 * - BrowserState: Overall browser connection and tab state
 * - ExtensionMessage: Messages sent FROM the browser extension TO the server
 * - ServerMessage: Messages sent FROM the server TO the browser extension
 *
 * The message types define the WebSocket protocol between the MCP server
 * and the Chrome extension. All messages include an optional sessionId to
 * support multiple concurrent MCP clients.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ExtensionMessageType, ServerMessageType } from "./message-types.js";

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
  | { type: typeof ExtensionMessageType.CONNECTED; sessionId?: string; browser: { name: string; version: string }; tabs: TabInfo[] }
  | { type: typeof ExtensionMessageType.DISCONNECTED; sessionId?: string }
  | { type: typeof ExtensionMessageType.TAB_CREATED; sessionId?: string; tab: TabInfo; requestId?: string }
  | { type: typeof ExtensionMessageType.TAB_UPDATED; sessionId?: string; tab: TabInfo }
  | { type: typeof ExtensionMessageType.TAB_CLOSED; sessionId?: string; tabId: number }
  | { type: typeof ExtensionMessageType.TOOLS_CHANGED; sessionId?: string; tabId: number; tools: Tool[] }
  | { type: typeof ExtensionMessageType.TOOL_RESULT; sessionId?: string; callId: string; result: unknown; error?: string }
  | { type: typeof ExtensionMessageType.TOOLS_DISCOVERED; sessionId?: string; callId: string; tabId: number; tools: Tool[] }
  | { type: typeof ExtensionMessageType.TAB_FOCUSED; sessionId?: string; tabId: number; tools: Tool[]; requestId?: string }
  | { type: typeof ExtensionMessageType.PING };

// Messages from MCP server to extension
export type ServerMessage =
  | { type: typeof ServerMessageType.CONNECT; sessionId?: string; launch?: boolean }
  | { type: typeof ServerMessageType.OPEN_TAB; sessionId?: string; url: string; focus: boolean; requestId?: string }
  | { type: typeof ServerMessageType.CLOSE_TAB; sessionId?: string; tabId: number }
  | { type: typeof ServerMessageType.CALL_TOOL; sessionId?: string; callId: string; tabId: number; toolName: string; args: Record<string, unknown> }
  | { type: typeof ServerMessageType.DISCOVER_TOOLS; sessionId?: string; callId: string; tabId: number }
  | { type: typeof ServerMessageType.PONG };
