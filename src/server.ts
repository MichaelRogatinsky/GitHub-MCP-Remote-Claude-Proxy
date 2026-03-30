import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer() {
  const server = new McpServer({
    name: "GitHub MCP Proxy",
    version: "0.1.0",
  });

  server.tool("hello", "A simple hello world test tool", {}, async () => {
    return {
      content: [
        {
          type: "text",
          text: "Hello from the remote MCP server! 🚀 The connection is working.",
        },
      ],
    };
  });

  return server;
}
