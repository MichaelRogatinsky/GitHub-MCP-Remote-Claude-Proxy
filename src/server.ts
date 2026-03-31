import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { githubGet, githubRequest } from "./github.js";

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

  server.tool(
    "list_directory",
    "List the contents of a directory in a GitHub repository",
    {
      owner: z.string().describe("Repository owner (user or org)"),
      repo: z.string().describe("Repository name"),
      path: z
        .string()
        .optional()
        .describe("Directory path within the repo (default: root)"),
      ref: z
        .string()
        .optional()
        .describe("Branch, tag, or commit SHA (default: repo's default branch)"),
    },
    async ({ owner, repo, path, ref }) => {
      const apiPath = `/repos/${owner}/${repo}/contents/${path ?? ""}`;
      const params = new URLSearchParams();
      if (ref) params.set("ref", ref);
      const qs = params.toString();
      const url = qs ? `${apiPath}?${qs}` : apiPath;

      const data = await githubGet(url);

      // GitHub returns an array for directories, a single object for files.
      if (!Array.isArray(data)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Path points to a file, not a directory: ${data.name} (${data.size} bytes)`,
            },
          ],
        };
      }

      const entries = data.map(
        (e: { name: string; type: string; size: number; path: string }) => ({
          name: e.name,
          type: e.type, // "file", "dir", or "submodule"
          size: e.size,
          path: e.path,
        })
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(entries, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "read_file",
    "Read the contents of a file in a GitHub repository, optionally returning only a specific line range",
    {
      owner: z.string().describe("Repository owner (user or org)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path within the repo"),
      ref: z
        .string()
        .optional()
        .describe("Branch, tag, or commit SHA (default: repo's default branch)"),
      start_line: z
        .number()
        .min(1)
        .optional()
        .describe("First line to return (1-based, inclusive)"),
      end_line: z
        .number()
        .min(1)
        .optional()
        .describe("Last line to return (1-based, inclusive)"),
    },
    async ({ owner, repo, path, ref, start_line, end_line }) => {
      const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
      const params = new URLSearchParams();
      if (ref) params.set("ref", ref);
      const qs = params.toString();
      const url = qs ? `${apiPath}?${qs}` : apiPath;

      const data = await githubGet(url);

      if (data.type !== "file" || !data.content) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Path is not a file (type: ${data.type})`,
            },
          ],
        };
      }

      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      let lines = decoded.split("\n");

      const totalLines = lines.length;
      if (start_line || end_line) {
        const start = (start_line ?? 1) - 1;
        const end = end_line ?? totalLines;
        lines = lines.slice(start, end);
      }

      // Add line numbers
      const startNum = start_line ?? 1;
      const numbered = lines
        .map((line, i) => `${startNum + i}\t${line}`)
        .join("\n");

      const header = `File: ${data.path} (${totalLines} lines total)`;

      return {
        content: [
          {
            type: "text" as const,
            text: `${header}\n\n${numbered}`,
          },
        ],
      };
    }
  );

  server.tool(
    "create_or_update_file",
    "Create or update a single file in a GitHub repository",
    {
      owner: z.string().describe("Repository owner (user or org)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path within the repo"),
      content: z.string().describe("The new file content (plain text, will be base64-encoded automatically)"),
      message: z.string().describe("Commit message"),
      branch: z
        .string()
        .optional()
        .describe("Branch to commit to (default: repo's default branch)"),
      sha: z
        .string()
        .optional()
        .describe(
          "SHA of the file being replaced (required for updates, omit for new files). " +
          "If not provided for an existing file, the tool will fetch it automatically."
        ),
    },
    async ({ owner, repo, path, content, message, branch, sha }) => {
      // If no sha provided, try to fetch the existing file to get it.
      // This makes updates seamless — callers don't need to track SHAs.
      let fileSha = sha;
      if (!fileSha) {
        try {
          const params = new URLSearchParams();
          if (branch) params.set("ref", branch);
          const qs = params.toString();
          const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
          const existing = await githubGet(qs ? `${apiPath}?${qs}` : apiPath);
          if (existing.sha) {
            fileSha = existing.sha;
          }
        } catch {
          // File doesn't exist yet — this is a create, no sha needed.
        }
      }

      const body: Record<string, string> = {
        message,
        content: Buffer.from(content).toString("base64"),
      };
      if (branch) body.branch = branch;
      if (fileSha) body.sha = fileSha;

      const result = await githubRequest(
        "PUT",
        `/repos/${owner}/${repo}/contents/${path}`,
        body
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                path: result.content.path,
                sha: result.content.sha,
                commit_sha: result.commit.sha,
                commit_message: result.commit.message,
                html_url: result.content.html_url,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "patch_file",
    "Apply search-and-replace edits to an existing file in a GitHub repository. " +
      "Each edit replaces the first occurrence of old_text with new_text. " +
      "Edits are applied sequentially, so later edits see the result of earlier ones.",
    {
      owner: z.string().describe("Repository owner (user or org)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path within the repo"),
      edits: z
        .array(
          z.object({
            old_text: z.string().describe("Exact text to find in the file"),
            new_text: z.string().describe("Text to replace it with"),
          })
        )
        .min(1)
        .describe("List of search-and-replace edits to apply in order"),
      message: z.string().describe("Commit message"),
      branch: z
        .string()
        .optional()
        .describe("Branch to commit to (default: repo's default branch)"),
    },
    async ({ owner, repo, path, edits, message, branch }) => {
      // Fetch the current file
      const params = new URLSearchParams();
      if (branch) params.set("ref", branch);
      const qs = params.toString();
      const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
      const existing = await githubGet(qs ? `${apiPath}?${qs}` : apiPath);

      if (existing.type !== "file" || !existing.content) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Path is not a file (type: ${existing.type})`,
            },
          ],
        };
      }

      let content = Buffer.from(existing.content, "base64").toString("utf-8");

      // Apply edits sequentially
      const failed: string[] = [];
      for (const edit of edits) {
        if (!content.includes(edit.old_text)) {
          failed.push(edit.old_text);
          continue;
        }
        content = content.replace(edit.old_text, edit.new_text);
      }

      if (failed.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `${failed.length} edit(s) failed — old_text not found in file:\n\n` +
                failed.map((t) => `  "${t.length > 80 ? t.slice(0, 80) + "…" : t}"`).join("\n"),
            },
          ],
          isError: true,
        };
      }

      // Commit the updated file
      const body: Record<string, string> = {
        message,
        content: Buffer.from(content).toString("base64"),
        sha: existing.sha,
      };
      if (branch) body.branch = branch;

      const result = await githubRequest("PUT", apiPath, body);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                path: result.content.path,
                sha: result.content.sha,
                commit_sha: result.commit.sha,
                commit_message: result.commit.message,
                edits_applied: edits.length,
                html_url: result.content.html_url,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
