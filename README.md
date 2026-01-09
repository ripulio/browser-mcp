# Browser MCP

Control Chrome browsers and use page-specific tools exposed via `navigator.modelContext`.

Two ways to use:
1. **MCP Server** - Traditional MCP tool integration
2. **Skill** - Direct HTTP API for Claude to curl

## Architecture

**MCP Server approach:**
```
Claude Code ←─ stdio ─→ MCP Server ←─ WebSocket ─→ Chrome Extension ←─→ Page
```

**Skill approach:**
```
Claude (curl) ──→ HTTP API ──→ ws-server.js ──→ WebSocket ──→ Chrome Extension ←─→ Page
```

- **MCP Server**: Node.js server exposing a single `browser` tool with multiple actions
- **Chrome Extension**: MV3 service worker that manages tabs and executes page tools
- **WebSocket**: Communication bridge on `ws://localhost:8765`

## Setup

### 1. Install dependencies and build

```bash
npm install
npm run build
```

### 2. Load the Chrome extension

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/extension` folder

### 3. Add MCP server to Claude Code

```bash
claude mcp add browser node /path/to/browser-mcp/packages/mcp-server/dist/index.js
```

Or add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "browser": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/browser-mcp/packages/mcp-server/dist/index.js"]
    }
  }
}
```

## Skill (Alternative)

The skill provides a direct HTTP API that Claude can use via curl, without the MCP server middleman.

### Start the bridge server

```bash
node skills/browser-control/scripts/ws-server.js &
```

### Use the HTTP API

```bash
# Check connection
curl localhost:8766/status

# List tabs
curl localhost:8766/tabs

# Open a tab
curl -X POST localhost:8766/tabs -H "Content-Type: application/json" -d '{"url":"https://example.com"}'

# Discover tools on a tab
curl localhost:8766/tabs/1/tools

# Call a tool
curl -X POST localhost:8766/tabs/1/tools/search -H "Content-Type: application/json" -d '{"query":"test"}'

# Close a tab
curl -X DELETE localhost:8766/tabs/1
```

See `skills/browser-control/SKILL.md` for full documentation.

---

## MCP Server Usage

The MCP server exposes a single `browser` tool with an `action` parameter:

| Action | Description | Parameters |
|--------|-------------|------------|
| `connect` | Connect to browser extension | - |
| `list_tabs` | List all open tabs with their tools | - |
| `open_tab` | Open a new tab | `url` (required) |
| `close_tab` | Close a tab | `tabId` (required) |
| `<tool_name>` | Call a page-specific tool | `tabId` (required), plus tool-specific args |

### Example workflow

```
1. browser(action: "connect")           → Connect to Chrome
2. browser(action: "list_tabs")         → See open tabs and available tools
3. browser(action: "open_tab", url: "https://example.com")
4. browser(action: "<page_tool>", tabId: 123, ...)  → Use page-specific tools
5. browser(action: "close_tab", tabId: 123)
```

## Page-Specific Tools

Pages can expose tools via the `navigator.modelContext` API:

```javascript
navigator.modelContext = {
  list: () => [
    {
      name: "search",
      description: "Search the page",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"]
      }
    }
  ],
  executeTool: async (name, args) => {
    // Handle tool execution
  }
};
```

## Development

```bash
# Build everything
npm run build

# Build just the server
npm run build:server

# Build just the extension
npm run build:extension
```

After rebuilding the extension, reload it in `chrome://extensions/`.

## Project Structure

```
packages/
├── extension/           # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── src/
│   │   ├── background.ts   # Service worker, WebSocket client
│   │   └── types.ts
│   └── dist/
│
└── mcp-server/          # MCP Server
    ├── src/
    │   ├── index.ts            # Entry point, tool handlers
    │   ├── extension-client.ts # WebSocket server
    │   ├── tools.ts            # Tool definitions
    │   ├── state.ts            # Connection state
    │   └── types.ts
    └── dist/
```
