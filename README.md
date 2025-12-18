# Browser MCP

An MCP server that lets Claude Code control Chrome browsers. Open tabs, interact with pages, and use page-specific tools exposed via `navigator.modelContext`.

## Architecture

```
Claude Code ←─ stdio ─→ MCP Server ←─ WebSocket ─→ Chrome Extension ←─ userScripts ─→ Page
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

## Usage

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
