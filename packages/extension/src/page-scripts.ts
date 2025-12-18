/**
 * Page-Injected Scripts
 *
 * IMPORTANT: These functions are STRINGIFIED and injected into web pages.
 * They run in the page's MAIN world, NOT the extension context.
 *
 * Constraints:
 * - Cannot access extension variables, imports, or closures
 * - navigator.modelContext is only available in page context (see page-context.d.ts)
 * - Parameters must be passed via toInjectedScript() which JSON-serializes them
 * - Return values are serialized back through chrome.userScripts.execute()
 */

// Import ambient types (compile-time only, not bundled)
import "./page-context.js";

/**
 * Discovers available tools exposed by the page via navigator.modelContext.
 * Returns an empty array if modelContext is not available.
 */
export function discoverToolsScript(): ModelContextTool[] {
  if (!navigator.modelContext?.list) {
    return [];
  }
  return [...navigator.modelContext.list()];
}

/**
 * Executes a tool on the page via navigator.modelContext.executeTool().
 * Returns { result } on success or { error } on failure.
 */
export async function executeToolScript(
  toolName: string,
  args: unknown
): Promise<{ result?: unknown; error?: string }> {
  // Note: LOG_PREFIX must be defined inside the function since this is stringified
  const LOG_PREFIX = "[BrowserMCP Page]";

  console.log(`${LOG_PREFIX} Executing tool:`, toolName, "with args:", args);

  if (!navigator.modelContext?.executeTool) {
    console.error(`${LOG_PREFIX} navigator.modelContext not available`);
    return { error: "navigator.modelContext not available" };
  }

  try {
    console.log(`${LOG_PREFIX} Calling navigator.modelContext.executeTool...`);
    const result = await navigator.modelContext.executeTool(toolName, args);
    console.log(`${LOG_PREFIX} Tool result:`, result);
    return { result };
  } catch (e) {
    console.error(`${LOG_PREFIX} Tool execution error:`, e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Wraps a function as an IIFE string with injected arguments.
 * The function is stringified and called immediately with the provided args.
 *
 * @example
 * toInjectedScript(discoverToolsScript)
 * // Returns: "(function discoverToolsScript() { ... })()"
 *
 * @example
 * toInjectedScript(executeToolScript, "myTool", { foo: "bar" })
 * // Returns: "(async function executeToolScript(...) { ... })(\"myTool\", {\"foo\":\"bar\"})"
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toInjectedScript<T extends (...args: any[]) => any>(
  fn: T,
  ...args: Parameters<T>
): string {
  const argsJson = args.map((a) => JSON.stringify(a)).join(", ");
  return `(${fn.toString()})(${argsJson})`;
}
