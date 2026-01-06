/**
 * WebSocket Server - Connection Infrastructure
 *
 * This module manages the WebSocket server that communicates with the browser
 * extension. Responsibilities:
 * - Dynamic port allocation (8765-8785) to support multiple MCP server instances
 * - Discovery file management (/tmp/browser-mcp/) so the extension can find servers
 * - WebSocket connection lifecycle (accept, reject duplicates, handle close)
 * - Low-level message send/receive with ping/pong keepalive
 *
 * The extension scans all ports in the range and connects to each available
 * server, enabling multiple Claude clients to control the same browser.
 */
import { ServerMessage } from "./types.js";
export declare function startServer(): Promise<void>;
export declare function send(message: ServerMessage): void;
export declare function isSocketConnected(): boolean;
export declare function getActivePort(): number | null;
