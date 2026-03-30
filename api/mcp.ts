import { createServer } from "../src/server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// Vercel serverless functions are stateless — each request gets a fresh
// transport+server pair running in "stateless" mode (no session tracking).
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const server = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  await server.connect(transport);

  await transport.handleRequest(req, res);
}
