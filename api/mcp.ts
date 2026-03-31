import { createServer } from "../src/server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// Vercel pre-parses request bodies — extend the type to access it.
interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

// Vercel serverless functions are stateless — each request gets a fresh
// transport+server pair running in "stateless" mode (no session tracking).
export default async function handler(
  req: VercelRequest,
  res: ServerResponse
) {
  const server = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  await server.connect(transport);

  // Pass req.body so the SDK doesn't try to re-read the already-consumed stream.
  await transport.handleRequest(req, res, req.body);
}
