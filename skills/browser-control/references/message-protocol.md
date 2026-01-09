# WebSocket Message Protocol

This document defines the WebSocket message protocol between the bridge server and the browser extension.

## Overview

All messages are JSON objects with a `type` field. Messages optionally include a `sessionId` for multi-client support.

## Server → Extension Messages

### connect

Establish connection with the extension.

```json
{
  "type": "connect",
  "sessionId": "session123"
}
```

### openTab

Open a new browser tab.

```json
{
  "type": "openTab",
  "sessionId": "session123",
  "url": "https://example.com",
  "focus": true,
  "requestId": "open_1"
}
```

- `url` - URL to open
- `focus` - Whether to focus the new tab
- `requestId` - Correlates with `tabCreated` response

### closeTab

Close a browser tab.

```json
{
  "type": "closeTab",
  "sessionId": "session123",
  "tabId": 123
}
```

### callTool

Execute a tool on a page.

```json
{
  "type": "callTool",
  "sessionId": "session123",
  "callId": "call_1",
  "tabId": 123,
  "toolName": "search",
  "args": {"query": "test"}
}
```

- `callId` - Correlates with `toolResult` response
- `tabId` - Target tab ID
- `toolName` - Name of the tool to call
- `args` - Tool arguments

### discoverTools

Request available tools for a tab.

```json
{
  "type": "discoverTools",
  "sessionId": "session123",
  "callId": "discover_1",
  "tabId": 123
}
```

### pong

Response to ping (keepalive).

```json
{
  "type": "pong"
}
```

## Extension → Server Messages

### connected

Connection established, includes browser info and initial tabs.

```json
{
  "type": "connected",
  "sessionId": "session123",
  "browser": {
    "name": "Chrome",
    "version": "120.0.0.0"
  },
  "tabs": [
    {
      "id": 1,
      "title": "Example",
      "url": "https://example.com",
      "tools": []
    }
  ]
}
```

### disconnected

Extension disconnected.

```json
{
  "type": "disconnected",
  "sessionId": "session123"
}
```

### tabCreated

New tab was created.

```json
{
  "type": "tabCreated",
  "sessionId": "session123",
  "tab": {
    "id": 2,
    "title": "New Tab",
    "url": "https://example.com",
    "tools": []
  },
  "requestId": "open_1"
}
```

### tabUpdated

Tab metadata changed.

```json
{
  "type": "tabUpdated",
  "sessionId": "session123",
  "tab": {
    "id": 2,
    "title": "Updated Title",
    "url": "https://example.com",
    "tools": [...]
  }
}
```

### tabClosed

Tab was closed.

```json
{
  "type": "tabClosed",
  "sessionId": "session123",
  "tabId": 2
}
```

### tabFocused

Tab gained focus.

```json
{
  "type": "tabFocused",
  "sessionId": "session123",
  "tabId": 1,
  "tools": [...]
}
```

### toolsChanged

Available tools on a tab changed.

```json
{
  "type": "toolsChanged",
  "sessionId": "session123",
  "tabId": 1,
  "tools": [
    {
      "name": "search",
      "description": "Search the page",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {"type": "string"}
        },
        "required": ["query"]
      }
    }
  ]
}
```

### toolsDiscovered

Response to discoverTools request.

```json
{
  "type": "toolsDiscovered",
  "sessionId": "session123",
  "callId": "discover_1",
  "tabId": 1,
  "tools": [...]
}
```

### toolResult

Response to callTool request.

```json
{
  "type": "toolResult",
  "sessionId": "session123",
  "callId": "call_1",
  "result": {"data": "..."},
  "error": null
}
```

On error:
```json
{
  "type": "toolResult",
  "sessionId": "session123",
  "callId": "call_1",
  "result": null,
  "error": "Tool execution failed: reason"
}
```

### ping

Keepalive ping from extension.

```json
{
  "type": "ping"
}
```

## Tool Schema

Tools follow the MCP Tool schema:

```json
{
  "name": "tool_name",
  "description": "What the tool does",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param1": {"type": "string", "description": "..."},
      "param2": {"type": "number"}
    },
    "required": ["param1"]
  }
}
```

## Discovery File

The server writes to `/tmp/browser-mcp/server-{pid}.json`:

```json
{
  "port": 8765,
  "pid": 12345,
  "startedAt": "2024-01-01T00:00:00.000Z"
}
```

The extension monitors this directory and connects to discovered servers.
