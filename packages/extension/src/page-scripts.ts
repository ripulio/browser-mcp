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
 *
 * ============================================================================
 * BUNDLER WARNING: DO NOT MINIFY THIS FILE
 * ============================================================================
 * Functions marked with @injectable are converted to strings via .toString()
 * and injected into web pages. Minification/bundling will BREAK them:
 * - Function name mangling breaks runtime detection
 * - Async/await transforms change the source code structure
 * - Tree shaking may remove "unused" code paths
 *
 * If using a bundler (webpack, esbuild, rollup, etc.), exclude this file:
 * - webpack: use 'exclude' in module.rules
 * - esbuild: use 'external' or separate entry point
 * - rollup: use 'external' option
 * ============================================================================
 */

// Import ambient types (compile-time only, not bundled)
import "./page-context.js";

/**
 * Discovers available tools exposed by the page via navigator.modelContext.
 * Returns an empty array if modelContext is not available.
 *
 * @preserve - Do not minify, this function is stringified
 * @injectable - Injected into page context via chrome.userScripts
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
 *
 * @preserve - Do not minify, this function is stringified
 * @injectable - Injected into page context via chrome.userScripts
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
 * Registry of injectable function names for runtime validation.
 * Add any function that will be passed to toInjectedScript here.
 */
const INJECTABLE_FUNCTIONS = new Set([
  "discoverToolsScript",
  "executeToolScript",
]);

/**
 * Wraps a function as an IIFE string with injected arguments.
 * The function is stringified and called immediately with the provided args.
 *
 * Includes runtime validation to detect bundler mangling - if a function's
 * name doesn't match the registry, it likely means a bundler minified it.
 *
 * @example
 * toInjectedScript(discoverToolsScript)
 * // Returns: "(function discoverToolsScript() { ... })()"
 *
 * @example
 * toInjectedScript(executeToolScript, "myTool", { foo: "bar" })
 * // Returns: "(async function executeToolScript(...) { ... })(\"myTool\", {\"foo\":\"bar\"})"
 *
 * @throws Error if the function appears to have been mangled by a bundler
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toInjectedScript<T extends (...args: any[]) => any>(
  fn: T,
  ...args: Parameters<T>
): string {
  // Runtime check: detect if bundler mangled the function name
  if (!INJECTABLE_FUNCTIONS.has(fn.name)) {
    throw new Error(
      `Injectable function "${fn.name}" not in registry. ` +
      `This may indicate bundler minification broke the function. ` +
      `Either add "${fn.name}" to INJECTABLE_FUNCTIONS or exclude page-scripts.ts from bundling.`
    );
  }

  const argsJson = args.map((a) => JSON.stringify(a)).join(", ");
  return `(${fn.toString()})(${argsJson})`;
}
