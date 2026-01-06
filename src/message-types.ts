/**
 * Message Type Constants
 *
 * This module defines constants for all WebSocket message types used in the
 * protocol between the MCP server and browser extension. Using constants
 * instead of magic strings provides:
 * - Compile-time typo detection
 * - Better IDE autocomplete
 * - Single source of truth for message type values
 */

/** Message types sent FROM the browser extension TO the MCP server */
export const ExtensionMessageType = {
  PING: "ping",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  TAB_CREATED: "tabCreated",
  TAB_UPDATED: "tabUpdated",
  TAB_CLOSED: "tabClosed",
  TAB_FOCUSED: "tabFocused",
  TOOLS_CHANGED: "toolsChanged",
  TOOL_RESULT: "toolResult",
  TOOLS_DISCOVERED: "toolsDiscovered",
} as const;

/** Message types sent FROM the MCP server TO the browser extension */
export const ServerMessageType = {
  PONG: "pong",
  CONNECT: "connect",
  OPEN_TAB: "openTab",
  FOCUS_TAB: "focusTab",
  CLOSE_TAB: "closeTab",
  CALL_TOOL: "callTool",
  DISCOVER_TOOLS: "discoverTools",
} as const;

