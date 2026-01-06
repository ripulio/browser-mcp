/**
 * Tool Definitions - MCP Tool Schema
 *
 * This module defines the MCP tools exposed by the server. Currently there
 * is a single "executeTool" tool that acts as a proxy for marshalling tool
 * calls to web pages via the browser extension.
 *
 * The executeTool uses an "action" parameter to dispatch to different
 * operations (connect, list_tabs, open_tab, close_tab) or to page-specific
 * tools exposed by web pages through navigator.modelContext.
 */
import { Tool } from "@modelcontextprotocol/sdk/types.js";
export declare const browserTool: Tool;
export declare function getTools(): Tool[];
