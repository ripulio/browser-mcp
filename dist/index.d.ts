#!/usr/bin/env node
/**
 * Browser MCP Server - Entry Point
 *
 * This is the main entry point for the Browser MCP server. It exposes a single
 * "executeTool" tool that proxies tool calls to web pages through the
 * Model Context Protocol (MCP).
 *
 * The server:
 * - Starts a WebSocket server for the Chrome extension to connect to
 * - Handles MCP tool requests via stdio transport
 * - Auto-connects to the extension on first action
 * - Routes browser actions: list_tabs, open_tab, close_tab
 * - Proxies page-specific tool calls to web pages via navigator.modelContext
 *
 * Architecture:
 * Claude Client <-> MCP (stdio) <-> This Server <-> WebSocket <-> Chrome Extension
 */
export {};
