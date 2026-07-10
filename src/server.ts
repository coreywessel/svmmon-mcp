#!/usr/bin/env node
/**
 * svmmon-mcp — stdio MCP server entrypoint.
 *
 * Boots a Model Context Protocol server over stdio, registers the Svmmon
 * tools, and dispatches CallTool requests to them through a single shared
 * SvmmonClient (which holds the user's svm_ key and maps API errors).
 *
 * SOFT gate: the server ALWAYS starts. A missing/invalid key never crashes the
 * process — it surfaces as a clean tool-error message on the first call. This
 * keeps `npx svmmon-mcp` install-and-list working even before a key is pasted.
 *
 * The tool files imported below are owned by the parallel tool-builders. Their
 * paths + the SvmmonTool contract (src/types.ts) are fixed here; the builders
 * fill in the implementations.
 */

import { readFileSync } from 'node:fs';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { SvmmonClient, SvmmonApiError, SvmmonConfigError } from './client.js';
import type { SvmmonTool, ToolResult } from './types.js';

// The tools. These paths are the fixed contract — do not rename.
import getUsage from './tools/getUsage.js';
import listProfiles from './tools/listProfiles.js';
import listPresets from './tools/listPresets.js';
import generateHooks from './tools/generateHooks.js';
import generateSlideshow from './tools/generateSlideshow.js';
import listSlideshows from './tools/listSlideshows.js';
import getSlideshow from './tools/getSlideshow.js';
import generateImage from './tools/generateImage.js';
import generateVideo from './tools/generateVideo.js';
import getBrain from './tools/getBrain.js';
import getCommunityBrain from './tools/getCommunityBrain.js';
import getPerformance from './tools/getPerformance.js';
import getTiktokInsights from './tools/getTiktokInsights.js';
import listCollections from './tools/listCollections.js';
import getCollection from './tools/getCollection.js';
import listStudioProviders from './tools/listStudioProviders.js';
import listStudioHistory from './tools/listStudioHistory.js';
import listStudioSaves from './tools/listStudioSaves.js';

const TOOLS: SvmmonTool[] = [
  getUsage,
  listProfiles,
  listPresets,
  generateHooks,
  generateSlideshow,
  listSlideshows,
  getSlideshow,
  generateImage,
  generateVideo,
  getBrain,
  getCommunityBrain,
  getPerformance,
  getTiktokInsights,
  listCollections,
  getCollection,
  listStudioProviders,
  listStudioHistory,
  listStudioSaves,
];

const TOOLS_BY_NAME = new Map<string, SvmmonTool>(TOOLS.map((t) => [t.name, t]));

/**
 * Self-reported server version, read from package.json so it can never drift
 * from the published version again (an audit found this hardcoded at 1.0.0
 * while the package was at 1.1.1). package.json ships in the npm tarball one
 * level above dist/, so this resolves both from source (src/) and build (dist/).
 */
function packageVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof version === 'string' && version) return version;
  } catch {
    // fall through to the baked-in fallback
  }
  return '1.2.0';
}

const server = new Server(
  {
    name: 'svmmon-mcp',
    version: packageVersion(),
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, (async (req): Promise<ToolResult> => {
  const tool = TOOLS_BY_NAME.get(req.params.name);
  if (!tool) {
    return errorResult(`Unknown tool: ${req.params.name}`);
  }

  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  // SOFT gate: resolve the client per-call so a missing/invalid key becomes a
  // clean tool-error message instead of a startup crash.
  let client: SvmmonClient;
  try {
    client = SvmmonClient.fromEnv();
  } catch (err) {
    if (err instanceof SvmmonConfigError) return errorResult(err.message);
    throw err;
  }

  try {
    return await tool.handler(args, client);
  } catch (err) {
    // Catch-all safety net. Tools are expected to convert SvmmonApiError into a
    // clean ToolResult themselves, but if one throws, map it here so the agent
    // still sees a human message — and never a stack trace or the key.
    if (err instanceof SvmmonApiError || err instanceof SvmmonConfigError) {
      return errorResult(err.message);
    }
    return errorResult('Unexpected error running the tool. Please try again.');
  }
  // The SDK's CallTool result type is a union that also covers a long-running
  // "task" variant we never use; our ToolResult is the standard content result.
  // Cast the handler at this boundary so tool authors keep the clean
  // SvmmonTool contract (a plain { content } result).
}) as Parameters<typeof server.setRequestHandler>[1]);

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP transport — diagnostics must go to stderr only.
  process.stderr.write('svmmon-mcp running on stdio\n');
}

main().catch((err) => {
  // Last-resort startup failure. Write a generic line to stderr (never the key)
  // and exit non-zero so the client surfaces a launch failure.
  process.stderr.write(`svmmon-mcp failed to start: ${err instanceof Error ? err.message : 'unknown error'}\n`);
  process.exit(1);
});
