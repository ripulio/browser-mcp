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

import { WebSocketServer, WebSocket } from "ws";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ExtensionMessage, ServerMessage } from "./types.js";
import { ExtensionMessageType, ServerMessageType } from "./message-types.js";
import { handleExtensionMessage, handleDisconnect } from "./message-handler.js";

const WS_PORT_START = 8765;
const WS_PORT_END = 8785;
const DISCOVERY_DIR = join(tmpdir(), "browser-mcp");

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let activePort: number | null = null;
let portFilePath: string | null = null;

async function findAvailablePort(): Promise<number> {
  for (let port = WS_PORT_START; port <= WS_PORT_END; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = new WebSocketServer({ port });
        testServer.on("listening", () => {
          testServer.close();
          resolve();
        });
        testServer.on("error", reject);
      });
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`No available ports in range ${WS_PORT_START}-${WS_PORT_END}`);
}

function writeDiscoveryFile(port: number): void {
  try {
    if (!existsSync(DISCOVERY_DIR)) {
      mkdirSync(DISCOVERY_DIR, { recursive: true });
    }
    portFilePath = join(DISCOVERY_DIR, `server-${process.pid}.json`);
    writeFileSync(portFilePath, JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }, null, 2));
    console.error(`Discovery file written: ${portFilePath}`);
  } catch (error) {
    console.error("Failed to write discovery file:", error);
  }
}

function removeDiscoveryFile(): void {
  if (portFilePath && existsSync(portFilePath)) {
    try {
      unlinkSync(portFilePath);
      console.error(`Discovery file removed: ${portFilePath}`);
    } catch (error) {
      console.error("Failed to remove discovery file:", error);
    }
  }
}

// Cleanup on process exit
process.on("exit", removeDiscoveryFile);
process.on("SIGINT", () => { removeDiscoveryFile(); process.exit(0); });
process.on("SIGTERM", () => { removeDiscoveryFile(); process.exit(0); });

export async function startServer(): Promise<void> {
  if (wss) return;

  activePort = await findAvailablePort();
  console.error(`Found available port: ${activePort}`);

  wss = new WebSocketServer({ port: activePort });
  console.error(`WebSocket server listening on ws://localhost:${activePort}`);
  writeDiscoveryFile(activePort);

  wss.on("connection", (socket) => {
    console.error("Extension connected");

    if (extensionSocket) {
      console.error("Rejecting duplicate extension connection");
      socket.close();
      return;
    }

    extensionSocket = socket;

    socket.on("message", (data) => {
      let message: ExtensionMessage;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        console.error("Failed to parse message from extension:", error);
        return;
      }

      if (message.type === ExtensionMessageType.PING) {
        socket.send(JSON.stringify({ type: ServerMessageType.PONG }));
        return;
      }

      handleExtensionMessage(message);
    });

    socket.on("close", () => {
      console.error("Extension disconnected");
      extensionSocket = null;
      handleDisconnect();
    });

    socket.on("error", (error) => {
      console.error("Extension socket error:", error.message);
    });
  });

  wss.on("error", (error) => {
    console.error("WebSocket server error:", error.message);
  });
}

export function send(message: ServerMessage): void {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Extension not connected");
  }
  extensionSocket.send(JSON.stringify(message));
}

export function isSocketConnected(): boolean {
  return extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;
}

export function getActivePort(): number | null {
  return activePort;
}
