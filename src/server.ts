import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { githubGet } from "./github.js";

export function createServer() {
  const server = new McpServer({
    name: "GitHub MCP Proxy",
    version: "0.1.0",
  });

  server.tool(
    "list_repositories",
    "List GitHub repositories for the authenticated user or a specified user/org",
    {
      owner: z
        .string()
        .optional()
        .describe(
          "Username or org to list repos for. Omit for the authenticated user's repos."
        ),
      type: z
        .enum(["all", "owner", "public", "private", "member"])
        .optional()
        .describe("Filter by repo type (default: all)"),
      sort: z
        .enum(["created", "updated", "pushed", "full_name"])
        .optional()
        .describe("Sort field (default: full_name)"),
      per_page: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Results per page, max 100 (default: 30)"),
      page: z.number().min(1).optional().describe("Page number (default: 1)"),
    },
    async ({ owner, type, sort, per_page, page }) => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (sort) params.set("sort", sort);
      if (per_page) params.set("per_page", String(per_page));
      if (page) params.set("page", String(page));

      const qs = params.toString();
      const path = owner ? `/users/${owner}/repos` : "/user/repos";
      const url = qs ? `${path}?${qs}` : path;

      const repos = await githubGet(url);

      const summary = repos.map(
        (r: {
          full_name: string;
          description: string | null;
          private: boolean;
          language: string | null;
          stargazers_count: number;
          updated_at: string;
        }) => ({
          full_name: r.full_name,
          description: r.description,
          private: r.private,
          language: r.language,
          stars: r.stargazers_count,
          updated_at: r.updated_at,
        })
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
