# Progressive Tool Disclosure Pattern

## Problem

When pages expose many tools via `navigator.modelContext`, all tool definitions (name, description, inputSchema) get serialized into the LLM context. This wastes tokens on tools that may never be used.

**Example:** 50 tools × ~100 tokens/tool = **5,000 tokens** just for tool definitions.

## Solution: Category Tools with Lazy Expansion

### Pattern Overview

```
Initial Discovery (cheap):
  └── admin_tools (category) → "Manage users, roles, permissions"
  └── content_tools (category) → "Create, edit, publish content"
  └── analytics_tools (category) → "View metrics and reports"

On-Demand Expansion (when LLM calls admin_tools):
  └── create_user, delete_user, assign_role, list_permissions...
```

## API Design

### 1. Category Tool Registration

```typescript
navigator.modelContext.registerCategory({
  name: "admin_tools",
  description: "User and permission management (15 tools)",
  tools: [
    { name: "create_user", description: "...", inputSchema: {...}, execute: ... },
    { name: "delete_user", description: "...", inputSchema: {...}, execute: ... },
    // ... more tools
  ]
});
```

### 2. How list() Changes

```typescript
// Current: Returns ALL tools (expensive)
navigator.modelContext.list() → [tool1, tool2, ..., tool50]

// New: Returns categories + uncategorized tools
navigator.modelContext.list() → [
  { name: "admin_tools", description: "...", isCategory: true, toolCount: 15 },
  { name: "content_tools", description: "...", isCategory: true, toolCount: 8 },
  { name: "hello_world", description: "...", inputSchema: {...} }  // uncategorized
]
```

### 3. Category Expansion

When the LLM calls a category tool, it returns the contained tools:

```typescript
// LLM calls: admin_tools()
// Returns:
{
  content: [{
    type: "text",
    text: "Admin tools available:\n- create_user: Create a new user\n- delete_user: ..."
  }],
  tools: [  // NEW: tools field for dynamic registration
    { name: "create_user", description: "...", inputSchema: {...} },
    { name: "delete_user", description: "...", inputSchema: {...} },
  ]
}
```

## Implementation Options

### Option A: Pure Convention (No API Changes)

Pages just register a tool named `<category>_tools` that returns tool info as text.

```javascript
navigator.modelContext.registerTool({
  name: "admin_tools",
  description: "User management tools - call this to see available admin operations",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({
    content: [{
      type: "text",
      text: `Available admin tools:
- create_user(name, email, role): Create a new user
- delete_user(userId): Delete a user
- assign_role(userId, role): Change user's role`
    }]
  })
});
```

**Pros:** Works today, no changes needed
**Cons:** No automatic expansion, relies on LLM following instructions

### Option B: ModelContext API Extension (Recommended)

Add formal category support to the polyfill:

```typescript
interface ModelContext {
  // Existing
  registerTool(tool: ToolDefinition): void;
  list(): ToolDefinitionInfo[];
  executeTool(name: string, args: unknown): Promise<CallToolResult>;

  // New
  registerCategory(category: CategoryDefinition): void;
  expandCategory(name: string): ToolDefinitionInfo[];
}

interface CategoryDefinition {
  name: string;
  description: string;
  tools: ToolDefinition[];
}
```

**Pros:** Clean API, predictable behavior, automatic token savings
**Cons:** Requires changes to web-mcp polyfill and browser-mcp

### Option C: Hybrid - Special Return Type

Keep current API but handle `tools` in return values specially:

```typescript
// When a tool returns this shape, browser-mcp auto-registers the tools
{
  content: [...],
  tools: [{ name: "...", description: "...", inputSchema: {...} }]
}
```

**Pros:** Backwards compatible, incremental adoption
**Cons:** Magic behavior, less explicit

## Token Savings

| Scenario | Before | After | Savings |
|----------|--------|-------|---------|
| 50 tools, 1 category used | 5,000 tokens | 650 tokens | 87% |
| 50 tools, no categories used | 5,000 tokens | 150 tokens | 97% |
| 10 tools, all used | 1,000 tokens | 1,000 tokens | 0% |

## Files to Modify (Option B)

### web-mcp/packages/polyfill/src/main.ts
- Add `CategoryDefinition` interface
- Add `registerCategory()` method
- Modify `list()` to support collapsed view
- Add `expandCategory()` method

### browser-mcp/packages/extension/src/background.ts
- Handle category expansion in tool discovery
- Support dynamic tool registration after category call

### browser-mcp/packages/mcp-server/src/tools.ts
- Add category-aware tool listing

---

## Part 2: Layered Architecture

### Design Principle

**web-mcp should remain minimal and standards-track.** Enhancement, mediation, and optimization are separate concerns that layer on top.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Consumer Applications                                 │
│  (Claude Code, IDE plugins, automation scripts)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Mediation (OPTIONAL)                                  │
│  - Tool enhancement                                             │
│  - Grouping/categorization                     ┌──────────────┐ │
│  - Caching                                     │ tool-mediator│ │
│  - Token optimization                          │ (separate pkg)│ │
│                                                └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Transport/Bridge                                      │
│  - WebSocket communication          ┌────────────┐              │
│  - Tab management                   │ browser-mcp│              │
│  - MCP protocol translation         └────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 0: Core Protocol (STANDARDS-TRACK)                       │
│  - navigator.modelContext API       ┌────────────┐              │
│  - Tool registration                │  web-mcp   │              │
│  - Tool execution                   │ (polyfill) │              │
│  - Minimal, stable interface        └────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Web Page                                                       │
│  (registers tools via navigator.modelContext)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 0: Core Protocol (web-mcp)

**Goal:** Minimal, stable API suitable for W3C standardization.

```typescript
// This is ALL web-mcp should define
interface ModelContext {
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): void;
  list(): Iterable<ToolDefinitionInfo>;
  executeTool(name: string, args: unknown): Promise<CallToolResult>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (input: unknown) => Promise<CallToolResult>;
}
```

**No enhancement, no grouping, no optimization.** Just the core contract between pages and consumers.

### Layer 1: Transport (browser-mcp)

**Goal:** Bridge web pages to MCP clients via WebSocket.

- Discovers tools from pages
- Routes tool calls
- Manages browser tabs
- Translates to MCP protocol

**Passthrough by default** - exposes tools exactly as registered.

### Layer 2: Mediation (separate package)

**Goal:** Optional middleware for consumers who need enhancement.

This is where the Mediator pattern lives - **outside web-mcp and browser-mcp**.

```
Separate Repos (npm packages):
├── web-mcp           → npm: webmcp-polyfill    # Layer 0 - standards-track
├── browser-mcp       → npm: browser-mcp        # Layer 1 - transport
└── tool-mediator     → npm: @webmcp/mediator   # Layer 2 - optional (NEW REPO)
```

### Integration Pattern

Each layer is independently installable. Consumers compose what they need:

```typescript
// Minimal setup (no mediation)
import { startServer } from 'browser-mcp';
startServer();  // Tools passed through as-is

// With mediation
import { startServer, setToolMiddleware } from 'browser-mcp';
import { createMediator, RuleBasedTransformer } from '@webmcp/mediator';

const mediator = createMediator();
mediator.use(new RuleBasedTransformer());

setToolMiddleware(tools => mediator.enhance(tools));
startServer();
```

browser-mcp exposes a **middleware hook** but has **no dependency** on the mediator package.

---

## Part 3: Tool Mediator (Separate Package)

### Problem

A naive website author uses web-mcp and registers tools like:

```javascript
navigator.modelContext.registerTool({
  name: "gt_usr",
  description: "gets user",
  inputSchema: { type: "object" },
  execute: async (input) => { /* ... */ }
});

navigator.modelContext.registerTool({
  name: "del",
  description: "delete",
  inputSchema: { type: "object" },
  execute: async (input) => { /* ... */ }
});

// ... 20 more cryptic tools
```

The LLM sees garbage: poor names, no descriptions, no schemas. It can't use these tools effectively.

### Solution: Tool Mediator Pattern

The Mediator pattern decouples tool producers (web pages) from tool consumers (LLMs) by introducing an intermediary that can transform, enhance, filter, or aggregate tools.

```
┌─────────────┐                                    ┌─────────────────┐
│  Web Page   │──┐                            ┌───▶│  MCP Server     │
│  (raw tools)│  │    ┌──────────────────┐    │    │  (to LLM)       │
└─────────────┘  │    │                  │    │    └─────────────────┘
                 ├───▶│  ToolMediator    │────┤
┌─────────────┐  │    │                  │    │    ┌─────────────────┐
│  Another    │──┘    │  - transform()   │    └───▶│  Another        │
│  Source     │       │  - filter()      │         │  Consumer       │
└─────────────┘       │  - aggregate()   │         └─────────────────┘
                      └──────────────────┘
                               │
                      ┌────────┴────────┐
                      ▼                 ▼
              ┌─────────────┐   ┌─────────────┐
              │ Transformer │   │ Transformer │
              │ (LLM-based) │   │ (Rule-based)│
              └─────────────┘   └─────────────┘
```

### Core Interfaces

```typescript
/**
 * A tool as discovered from a source (web page, API, etc.)
 */
interface RawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * An enhanced tool ready for consumption
 */
interface EnhancedTool extends RawTool {
  originalName?: string;        // If renamed
  category?: string;            // Grouping
  confidence?: number;          // Enhancement confidence 0-1
  enhancedBy?: string;          // Which transformer was used
}

/**
 * Context about where tools came from
 */
interface ToolContext {
  source: string;               // e.g., domain, URL, API name
  sourceType: 'web' | 'api' | 'file' | 'manual';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * A transformer that can enhance tools
 * Implementations: LLM-based, rule-based, ML-based, manual overrides
 */
interface ToolTransformer {
  name: string;

  /**
   * Transform a batch of tools
   * @returns Enhanced tools, or null if this transformer can't help
   */
  transform(
    tools: RawTool[],
    context: ToolContext
  ): Promise<EnhancedTool[] | null>;

  /**
   * Priority (higher = tried first)
   */
  priority: number;
}

/**
 * The mediator coordinates between sources and consumers
 */
interface ToolMediator {
  /**
   * Register a transformer
   */
  use(transformer: ToolTransformer): void;

  /**
   * Process tools through the transformer chain
   */
  enhance(tools: RawTool[], context: ToolContext): Promise<EnhancedTool[]>;

  /**
   * Filter tools based on criteria
   */
  filter(tools: EnhancedTool[], criteria: FilterCriteria): EnhancedTool[];

  /**
   * Group tools into categories
   */
  categorize(tools: EnhancedTool[]): Map<string, EnhancedTool[]>;
}

interface FilterCriteria {
  categories?: string[];
  minConfidence?: number;
  namePattern?: RegExp;
  exclude?: string[];
}
```

### Example Transformer Implementations

```typescript
/**
 * Rule-based transformer using simple heuristics
 */
class RuleBasedTransformer implements ToolTransformer {
  name = 'rule-based';
  priority = 100;  // High priority, fast

  async transform(tools: RawTool[], context: ToolContext) {
    return tools.map(tool => ({
      ...tool,
      // Expand common abbreviations
      name: this.expandAbbreviations(tool.name),
      // Infer description from name if missing
      description: tool.description || this.inferDescription(tool.name),
      enhancedBy: this.name,
      confidence: 0.6,
    }));
  }

  private expandAbbreviations(name: string): string {
    const abbrevs: Record<string, string> = {
      'usr': 'user', 'msg': 'message', 'del': 'delete',
      'upd': 'update', 'gt': 'get', 'lst': 'list',
    };
    // ... expansion logic
  }
}

/**
 * LLM-based transformer for deeper analysis
 */
class LLMTransformer implements ToolTransformer {
  name = 'llm';
  priority = 50;  // Lower priority, slower but smarter

  constructor(private llmClient: LLMClient) {}

  async transform(tools: RawTool[], context: ToolContext) {
    const prompt = this.buildPrompt(tools, context);
    const result = await this.llmClient.complete(prompt);
    return this.parseResult(result, tools);
  }
}

/**
 * Cache transformer - wraps another transformer with caching
 */
class CachedTransformer implements ToolTransformer {
  name: string;
  priority: number;

  constructor(
    private inner: ToolTransformer,
    private cache: Cache
  ) {
    this.name = `cached-${inner.name}`;
    this.priority = inner.priority + 10;  // Slightly higher priority
  }

  async transform(tools: RawTool[], context: ToolContext) {
    const key = this.cacheKey(tools, context);
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const result = await this.inner.transform(tools, context);
    if (result) await this.cache.set(key, result);
    return result;
  }
}

/**
 * Manual overrides - highest priority, deterministic
 */
class OverrideTransformer implements ToolTransformer {
  name = 'overrides';
  priority = 200;  // Highest priority

  constructor(private overrides: Map<string, ToolOverride>) {}

  async transform(tools: RawTool[], context: ToolContext) {
    const domainOverrides = this.overrides.get(context.source);
    if (!domainOverrides) return null;  // Pass to next transformer

    return tools.map(tool => {
      const override = domainOverrides[tool.name];
      if (!override) return { ...tool, enhancedBy: 'passthrough' };
      return { ...tool, ...override, enhancedBy: this.name, confidence: 1.0 };
    });
  }
}
```

### Mediator Implementation

```typescript
class DefaultToolMediator implements ToolMediator {
  private transformers: ToolTransformer[] = [];

  use(transformer: ToolTransformer): void {
    this.transformers.push(transformer);
    // Sort by priority (highest first)
    this.transformers.sort((a, b) => b.priority - a.priority);
  }

  async enhance(tools: RawTool[], context: ToolContext): Promise<EnhancedTool[]> {
    // Try each transformer in priority order
    for (const transformer of this.transformers) {
      const result = await transformer.transform(tools, context);
      if (result) return result;
    }

    // Fallback: return tools as-is
    return tools.map(t => ({ ...t, enhancedBy: 'none', confidence: 0 }));
  }

  filter(tools: EnhancedTool[], criteria: FilterCriteria): EnhancedTool[] {
    return tools.filter(tool => {
      if (criteria.minConfidence && (tool.confidence ?? 0) < criteria.minConfidence) {
        return false;
      }
      if (criteria.categories && tool.category &&
          !criteria.categories.includes(tool.category)) {
        return false;
      }
      if (criteria.exclude?.includes(tool.name)) {
        return false;
      }
      if (criteria.namePattern && !criteria.namePattern.test(tool.name)) {
        return false;
      }
      return true;
    });
  }

  categorize(tools: EnhancedTool[]): Map<string, EnhancedTool[]> {
    const categories = new Map<string, EnhancedTool[]>();
    for (const tool of tools) {
      const cat = tool.category || 'uncategorized';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(tool);
    }
    return categories;
  }
}
```

### Usage Example

```typescript
// Create mediator
const mediator = new DefaultToolMediator();

// Register transformers (order doesn't matter - sorted by priority)
mediator.use(new OverrideTransformer(loadOverrides()));      // priority: 200
mediator.use(new CachedTransformer(
  new LLMTransformer(anthropicClient),
  fileCache
));                                                           // priority: 60
mediator.use(new RuleBasedTransformer());                    // priority: 100

// Use in browser-mcp
async function discoverTools(tabId: number, domain: string) {
  const rawTools = await getRawToolsFromPage(tabId);

  const enhanced = await mediator.enhance(rawTools, {
    source: domain,
    sourceType: 'web',
    timestamp: Date.now(),
  });

  // Optionally filter/categorize
  const filtered = mediator.filter(enhanced, { minConfidence: 0.5 });
  const grouped = mediator.categorize(filtered);

  return { tools: filtered, categories: grouped };
}
```

### Mediator Capabilities

#### 1. Auto-Documentation
Send raw tool list to LLM with prompt:
```
These tools were discovered on {domain}. Analyze them and provide:
1. Better human-readable names
2. Detailed descriptions of what each likely does
3. Inferred input schemas based on name/context
4. Suggested groupings/categories

Raw tools:
- gt_usr: "gets user"
- del: "delete"
- upd_prf: "update profile"
...
```

#### 2. Auto-Grouping
LLM suggests categories:
```json
{
  "categories": [
    {
      "name": "user_management",
      "description": "Tools for managing user accounts",
      "tools": ["gt_usr", "del", "upd_prf"]
    }
  ]
}
```

#### 3. Schema Inference
From tool name + domain context, infer likely parameters:
```javascript
// Original
{ name: "search", inputSchema: {} }

// Enhanced
{
  name: "search",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number", description: "Max results", default: 10 }
    },
    required: ["query"]
  }
}
```

### Implementation Options

#### Option A: On-Demand Enhancement (Lazy)

Enhance tools only when the LLM asks for them:

```typescript
// In browser-mcp/mcp-server
async function listTools(tabId: number) {
  const rawTools = await discoverToolsForTab(tabId);

  // Check cache first
  const cached = await getEnhancedTools(domain);
  if (cached) return cached;

  // Enhance with LLM
  const enhanced = await mediator.enhance(rawTools, { domain });
  await cacheEnhancedTools(domain, enhanced);

  return enhanced;
}
```

**Pros:** Only pay LLM cost when tools are actually used
**Cons:** First request is slow

#### Option B: Background Enhancement (Eager)

Enhance tools immediately when page loads:

```typescript
// In browser-mcp/extension
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    const tools = await discoverTools(tabId);
    const domain = new URL(tab.url).hostname;

    // Fire-and-forget enhancement
    mediator.enhanceInBackground(tools, { domain, tabId });
  }
});
```

**Pros:** No latency when tools are requested
**Cons:** Wasted LLM calls for pages never used

#### Option C: Community Overrides

Allow curated tool definitions to override raw ones:

```typescript
// tool-overrides.json (per domain)
{
  "example.com": {
    "gt_usr": {
      "rename": "get_user",
      "description": "Retrieve a user by their ID or email address",
      "inputSchema": {
        "type": "object",
        "properties": {
          "userId": { "type": "number" },
          "email": { "type": "string" }
        }
      }
    }
  }
}
```

**Pros:** High quality, no LLM cost, deterministic
**Cons:** Requires manual curation, doesn't scale

#### Option D: Hybrid (Recommended)

1. Check community overrides first
2. Check local cache second
3. Fall back to LLM enhancement
4. Cache result locally

```typescript
async function getEnhancedTools(domain: string, rawTools: Tool[]) {
  // 1. Community overrides (instant, free)
  const overrides = await fetchOverrides(domain);
  if (overrides) return applyOverrides(rawTools, overrides);

  // 2. Local cache (instant, free)
  const cached = await localCache.get(domain);
  if (cached && !isStale(cached)) return cached.tools;

  // 3. LLM enhancement (slow, costs $)
  const enhanced = await llmEnhance(rawTools, domain);
  await localCache.set(domain, enhanced);

  return enhanced;
}
```

### Mediator Configuration

```typescript
interface MediatorConfig {
  // LLM settings
  llmProvider: 'anthropic' | 'openai' | 'local';
  model: string;
  apiKey?: string;

  // Caching
  cacheDir: string;
  cacheTTL: number;  // hours

  // Behavior
  autoEnhance: boolean;
  groupingThreshold: number;  // min tools to suggest grouping

  // Overrides
  overridesUrl?: string;  // remote override repository
}
```

### Cost Considerations

| Scenario | LLM Calls | Approx Cost |
|----------|-----------|-------------|
| 20 tools, first visit | 1 | ~$0.01 |
| 20 tools, cached | 0 | $0 |
| 100 tools, first visit | 1 | ~$0.03 |
| Community override exists | 0 | $0 |

Cache TTL of 7 days means ~4 LLM calls/month per frequently-used domain.

### Files to Add/Modify

**New: packages/mediator/** (in web-mcp or browser-mcp)
```
mediator/
├── src/
│   ├── index.ts          # Main mediator class
│   ├── llm-client.ts     # LLM API wrapper
│   ├── cache.ts          # Local caching
│   ├── overrides.ts      # Community override loader
│   └── prompts.ts        # Enhancement prompts
└── package.json
```

**Modify: browser-mcp/packages/mcp-server/src/index.ts**
- Integrate mediator into tool discovery flow

---

## Quick Start (Option A - No Code Changes)

To test the pattern today without any code changes:

```javascript
// Instead of registering 15 admin tools individually...
// Register one category tool that describes them

navigator.modelContext.registerTool({
  name: "admin_tools",
  description: "User & permission management. Call to see 15 available admin operations.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({
    content: [{
      type: "text",
      text: `## Admin Tools

### User Management
- **create_user**(name: string, email: string, role: string): Create new user
- **delete_user**(userId: number): Delete user by ID
- **update_user**(userId: number, updates: object): Update user details

### Role Management
- **list_roles**(): Get all available roles
- **assign_role**(userId: number, roleId: number): Assign role to user
- **revoke_role**(userId: number, roleId: number): Remove role from user

Call any of these tools directly with the specified parameters.`
    }]
  })
});

// Then register the actual tools (they won't flood initial discovery)
// The LLM will call admin_tools() first to learn what's available
```
