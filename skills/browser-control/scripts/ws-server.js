#!/usr/bin/env node

/**
 * WebSocket-to-HTTP Bridge Server
 *
 * This script acts as a bridge between Claude (via HTTP) and the browser extension (via WebSocket).
 * - HTTP API on port 8766 for Claude to make requests
 * - WebSocket server on port 8765-8785 for extension connection
 * - Discovery file written to /tmp/browser-mcp/ for extension auto-connect
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HTTP_PORT = 8766;
const WS_PORT_START = 8765;
const WS_PORT_END = 8785;
const DISCOVERY_DIR = '/tmp/browser-mcp';

// State
let wsClient = null;
let browserInfo = null;
const tabs = new Map();
const pendingRequests = new Map();
let callIdCounter = 0;

// Generate unique call ID
function generateCallId(prefix) {
  return `${prefix}_${++callIdCounter}`;
}

// Send message to extension
function sendToExtension(message) {
  if (!wsClient || wsClient.readyState !== 1) {
    throw new Error('Extension not connected');
  }
  wsClient.send(JSON.stringify(message));
}

// Wait for response with timeout
function waitForResponse(callId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(callId);
      reject(new Error('Request timeout'));
    }, timeout);

    pendingRequests.set(callId, { resolve, reject, timer });
  });
}

// Handle extension messages
function handleExtensionMessage(data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    console.error('Invalid JSON from extension');
    return;
  }

  switch (message.type) {
    case 'connected':
      browserInfo = message.browser;
      tabs.clear();
      for (const tab of message.tabs || []) {
        tabs.set(tab.id, tab);
      }
      console.log(`Connected to ${browserInfo?.name} ${browserInfo?.version}`);
      break;

    case 'disconnected':
      browserInfo = null;
      tabs.clear();
      console.log('Extension disconnected');
      break;

    case 'tabCreated': {
      tabs.set(message.tab.id, message.tab);
      if (message.requestId && pendingRequests.has(message.requestId)) {
        const { resolve, timer } = pendingRequests.get(message.requestId);
        clearTimeout(timer);
        pendingRequests.delete(message.requestId);
        resolve({ tab: message.tab });
      }
      break;
    }

    case 'tabUpdated':
      tabs.set(message.tab.id, message.tab);
      break;

    case 'tabClosed': {
      tabs.delete(message.tabId);
      const closeKey = `close_${message.tabId}`;
      if (pendingRequests.has(closeKey)) {
        const { resolve, timer } = pendingRequests.get(closeKey);
        clearTimeout(timer);
        pendingRequests.delete(closeKey);
        resolve({ closed: true });
      }
      break;
    }

    case 'tabFocused':
      if (tabs.has(message.tabId)) {
        const tab = tabs.get(message.tabId);
        tab.tools = message.tools || [];
        tabs.set(message.tabId, tab);
      }
      break;

    case 'toolsChanged':
      if (tabs.has(message.tabId)) {
        const tab = tabs.get(message.tabId);
        tab.tools = message.tools || [];
        tabs.set(message.tabId, tab);
      }
      break;

    case 'toolsDiscovered':
    case 'toolResult': {
      const { callId } = message;
      if (callId && pendingRequests.has(callId)) {
        const { resolve, reject, timer } = pendingRequests.get(callId);
        clearTimeout(timer);
        pendingRequests.delete(callId);
        if (message.error) {
          reject(new Error(message.error));
        } else if (message.type === 'toolsDiscovered') {
          resolve({ tools: message.tools || [] });
        } else {
          resolve({ result: message.result });
        }
      }
      break;
    }

    case 'ping':
      sendToExtension({ type: 'pong' });
      break;
  }
}

// Parse URL path
function parsePath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts;
}

// HTTP request handler
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  const parts = parsePath(url.pathname);
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Read body for POST requests
  let body = '';
  if (method === 'POST') {
    for await (const chunk of req) {
      body += chunk;
    }
  }

  try {
    let result;

    // GET /status
    if (method === 'GET' && parts.length === 1 && parts[0] === 'status') {
      result = {
        connected: wsClient?.readyState === 1,
        browser: browserInfo,
        tabCount: tabs.size
      };
    }
    // GET /tabs
    else if (method === 'GET' && parts.length === 1 && parts[0] === 'tabs') {
      result = { tabs: Array.from(tabs.values()) };
    }
    // POST /tabs (open tab)
    else if (method === 'POST' && parts.length === 1 && parts[0] === 'tabs') {
      const { url: tabUrl } = JSON.parse(body || '{}');
      if (!tabUrl) {
        throw new Error('URL required');
      }
      const requestId = generateCallId('open');
      sendToExtension({
        type: 'openTab',
        url: tabUrl,
        focus: true,
        requestId
      });
      result = await waitForResponse(requestId);
    }
    // DELETE /tabs/:id (close tab)
    else if (method === 'DELETE' && parts.length === 2 && parts[0] === 'tabs') {
      const tabId = parseInt(parts[1], 10);
      if (!tabs.has(tabId)) {
        throw new Error('Tab not found');
      }
      const closeKey = `close_${tabId}`;
      pendingRequests.set(closeKey, {
        resolve: null,
        reject: null,
        timer: null
      });
      sendToExtension({ type: 'closeTab', tabId });
      result = await waitForResponse(closeKey, 5000);
    }
    // GET /tabs/:id/tools (discover tools)
    else if (method === 'GET' && parts.length === 3 && parts[0] === 'tabs' && parts[2] === 'tools') {
      const tabId = parseInt(parts[1], 10);
      if (!tabs.has(tabId)) {
        throw new Error('Tab not found');
      }
      const callId = generateCallId('discover');
      sendToExtension({
        type: 'discoverTools',
        callId,
        tabId
      });
      result = await waitForResponse(callId, 10000);
    }
    // POST /tabs/:id/tools/:name (call tool)
    else if (method === 'POST' && parts.length === 4 && parts[0] === 'tabs' && parts[2] === 'tools') {
      const tabId = parseInt(parts[1], 10);
      const toolName = parts[3];
      if (!tabs.has(tabId)) {
        throw new Error('Tab not found');
      }
      const args = JSON.parse(body || '{}');
      const callId = generateCallId('call');
      sendToExtension({
        type: 'callTool',
        callId,
        tabId,
        toolName,
        args
      });
      result = await waitForResponse(callId);
    }
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Find available port
async function findAvailablePort() {
  for (let port = WS_PORT_START; port <= WS_PORT_END; port++) {
    try {
      await new Promise((resolve, reject) => {
        const testServer = createServer();
        testServer.once('error', reject);
        testServer.listen(port, () => {
          testServer.close(() => resolve(port));
        });
      });
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`No available ports in range ${WS_PORT_START}-${WS_PORT_END}`);
}

// Write discovery file
function writeDiscoveryFile(port) {
  if (!existsSync(DISCOVERY_DIR)) {
    mkdirSync(DISCOVERY_DIR, { recursive: true });
  }
  const filePath = join(DISCOVERY_DIR, `server-${process.pid}.json`);
  writeFileSync(filePath, JSON.stringify({
    port,
    pid: process.pid,
    startedAt: new Date().toISOString()
  }));
  return filePath;
}

// Cleanup discovery file
function cleanupDiscoveryFile() {
  const filePath = join(DISCOVERY_DIR, `server-${process.pid}.json`);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Main
async function main() {
  // Find available WebSocket port
  const wsPort = await findAvailablePort();
  console.log(`WebSocket server starting on port ${wsPort}`);

  // Start WebSocket server
  const wss = new WebSocketServer({ port: wsPort });

  wss.on('connection', (ws) => {
    if (wsClient) {
      console.log('Rejecting duplicate connection');
      ws.close();
      return;
    }

    wsClient = ws;
    console.log('Extension connected');

    // Send connect message
    sendToExtension({ type: 'connect' });

    ws.on('message', handleExtensionMessage);

    ws.on('close', () => {
      wsClient = null;
      browserInfo = null;
      tabs.clear();
      console.log('Extension disconnected');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });
  });

  // Write discovery file
  const discoveryFile = writeDiscoveryFile(wsPort);
  console.log(`Discovery file: ${discoveryFile}`);

  // Start HTTP server
  const httpServer = createServer(handleRequest);
  httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP API listening on port ${HTTP_PORT}`);
    console.log(`\nReady. Use curl to interact:`);
    console.log(`  curl localhost:${HTTP_PORT}/status`);
    console.log(`  curl localhost:${HTTP_PORT}/tabs`);
  });

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    cleanupDiscoveryFile();
    wss.close();
    httpServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanupDiscoveryFile();
    wss.close();
    httpServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
