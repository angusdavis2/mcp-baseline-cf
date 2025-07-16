import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolDefinitions, toolHandlers, setBaselineApiKey } from "./tools.js";

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "mcp-baseline-cf",
		version: "1.0.0",
	});

	async init() {
		// Initialize API key from environment
		const apiKey = (this as any).env?.BASELINE_API_KEY || "";
		if (!apiKey) {
			throw new Error("BASELINE_API_KEY environment variable is required");
		}
		setBaselineApiKey(apiKey);

		// Register all tools from the shared definitions
		for (const tool of toolDefinitions) {
			const handler = (toolHandlers as any)[tool.name];
			if (handler) {
				this.server.tool(tool.name, tool.description, tool.inputSchema.shape, (params: any) => {
					return handler(params);
				});
			}
		}
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// SSE endpoint - pure Server-Sent Events for real-time streaming
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		// MCP endpoint - Streamable HTTP (can return JSON or upgrade to SSE)
		if (url.pathname === "/mcp" || url.pathname === "/message") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	}
};

