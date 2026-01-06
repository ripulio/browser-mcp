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
export {};
