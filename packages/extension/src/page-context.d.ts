/**
 * Page Context Type Definitions
 *
 * IMPORTANT: These types describe APIs available in PAGE CONTEXT only.
 * They are NOT available in the extension's service worker.
 *
 * These types exist solely for type-checking functions in page-scripts.ts
 * that will be stringified and injected into web pages via chrome.userScripts.
 * The navigator.modelContext API is exposed by web pages that implement the
 * Model Context Protocol for browser automation.
 */

declare global {
  interface ModelContextTool {
    name: string;
    description?: string;
    inputSchema?: unknown;
  }

  interface ModelContext {
    list(): ModelContextTool[];
    executeTool(name: string, args: unknown): Promise<unknown>;
  }

  interface Navigator {
    modelContext?: ModelContext;
  }
}

export {};
