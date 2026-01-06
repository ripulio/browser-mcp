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
export declare const ExtensionMessageType: {
    readonly PING: "ping";
    readonly CONNECTED: "connected";
    readonly DISCONNECTED: "disconnected";
    readonly TAB_CREATED: "tabCreated";
    readonly TAB_UPDATED: "tabUpdated";
    readonly TAB_CLOSED: "tabClosed";
    readonly TAB_FOCUSED: "tabFocused";
    readonly TOOLS_CHANGED: "toolsChanged";
    readonly TOOL_RESULT: "toolResult";
    readonly TOOLS_DISCOVERED: "toolsDiscovered";
};
/** Message types sent FROM the MCP server TO the browser extension */
export declare const ServerMessageType: {
    readonly PONG: "pong";
    readonly CONNECT: "connect";
    readonly OPEN_TAB: "openTab";
    readonly FOCUS_TAB: "focusTab";
    readonly CLOSE_TAB: "closeTab";
    readonly CALL_TOOL: "callTool";
    readonly DISCOVER_TOOLS: "discoverTools";
};
