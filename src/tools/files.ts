import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import he from "he";

const execAsync = promisify(exec);

function decodeContent(content: string): string {
  return he.decode(content);
}

function requireVaultDir(): string {
  const dir = process.env.VAULT_DIR_PATH;
  if (!dir) throw new Error("VAULT_DIR_PATH is not configured");
  return dir;
}

async function vaultPath(vaultName: string): Promise<string> {
  const base = requireVaultDir();
  const resolved = path.resolve(base, vaultName);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new Error(`Vault name escapes VAULT_DIR_PATH: ${vaultName}`);
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${vaultName}`);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") throw new Error(`Vault not found: ${vaultName}`);
    throw err;
  }
  return resolved;
}

async function resolveFilePath(vaultName: string, fileName: string): Promise<string> {
  const vp = await vaultPath(vaultName);
  const resolved = path.resolve(vp, fileName);
  if (!resolved.startsWith(vp + path.sep) && resolved !== vp) {
    throw new Error(`Path escapes vault: ${fileName}`);
  }
  return resolved;
}

export const fileToolDefs: Tool[] = [
  {
    name: "list_vaults",
    description: "List all Obsidian vaults (directories containing a .obsidian folder)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_vault_contents",
    description: "Get a recursive listing of all files and folders in a vault. Returns an object with vaultName and an array of {fileName} entries. File names are relative to the vault root.",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
      },
      required: ["vaultName"],
    },
  },
  {
    name: "find_files",
    description: "Search for files by name within a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        query: { type: "string", description: "Filename pattern to search for (glob supported, e.g. '*.md')" },
      },
      required: ["vaultName", "query"],
    },
  },
  {
    name: "search_file",
    description: "Search for a pattern within the contents of a specific file in a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        fileName: { type: "string", description: "Path of the file relative to the vault root" },
        query: { type: "string", description: "Search pattern (regex supported)" },
      },
      required: ["vaultName", "fileName", "query"],
    },
  },
  {
    name: "get_file_contents",
    description: "Read the contents of a file in a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        fileName: { type: "string", description: "Path of the file relative to the vault root" },
      },
      required: ["vaultName", "fileName"],
    },
  },
  {
    name: "create_new_file",
    description: "Create a new file in a vault (auto-creates parent directories). HTML entities in content are automatically decoded.",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        fileName: { type: "string", description: "Path for the new file relative to the vault root" },
        content: { type: "string", description: "Content to write to the new file" },
      },
      required: ["vaultName", "fileName", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Overwrite the contents of an existing file in a vault. HTML entities in content are automatically decoded.",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        fileName: { type: "string", description: "Path of the file relative to the vault root" },
        content: { type: "string", description: "New content for the file" },
      },
      required: ["vaultName", "fileName", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file or folder in a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        fileName: { type: "string", description: "Path of the file or folder relative to the vault root" },
      },
      required: ["vaultName", "fileName"],
    },
  },
  {
    name: "move_file",
    description: "Move or rename a file or folder in a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        source: { type: "string", description: "Current path relative to the vault root" },
        destination: { type: "string", description: "New path relative to the vault root" },
      },
      required: ["vaultName", "source", "destination"],
    },
  },
  {
    name: "copy_file",
    description: "Copy a file in a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        source: { type: "string", description: "Source file path relative to the vault root" },
        destination: { type: "string", description: "Destination file path relative to the vault root" },
      },
      required: ["vaultName", "source", "destination"],
    },
  },
  {
    name: "make_folder",
    description: "Create a new folder (and any necessary parent folders) in a vault",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: { type: "string", description: "Name of the vault" },
        folderName: { type: "string", description: "Folder path relative to the vault root" },
      },
      required: ["vaultName", "folderName"],
    },
  },
];

export async function handleFileTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "list_vaults": {
      const base = requireVaultDir();
      const entries = await fs.readdir(base, { withFileTypes: true });
      const vaults: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const obsidianDir = path.join(base, entry.name, ".obsidian");
          const stat = await fs.stat(obsidianDir);
          if (stat.isDirectory()) vaults.push(entry.name);
        } catch {
          // no .obsidian folder — not a vault
        }
      }
      return JSON.stringify(vaults, null, 2);
    }

    case "get_vault_contents": {
      const vaultName = args.vaultName as string;
      const vp = await vaultPath(vaultName);
      const { stdout } = await execAsync(
        `find '${vp}' -not -path '*/.obsidian/*' -not -path '*/.git/*' 2>/dev/null`,
        { timeout: 15_000 }
      );
      const prefixLen = path.resolve(requireVaultDir()).length + 1 + vaultName.length + 1;
      const contents = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ fileName: line.slice(prefixLen) }))
        .filter((entry) => entry.fileName);
      return JSON.stringify({ vaultName, contents }, null, 2);
    }

    case "find_files": {
      const vp = await vaultPath(args.vaultName as string);
      const query = (args.query as string).replace(/'/g, "'\\''");
      const cmd = `find '${vp}' -not -path '*/.obsidian/*' -not -path '*/.git/*' -name '${query}' 2>/dev/null`;
      const { stdout } = await execAsync(cmd, { timeout: 15_000 });
      const baseLen = path.resolve(requireVaultDir()).length + 1;
      const results = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(baseLen));
      return results.length ? results.join("\n") : "(no files found)";
    }

    case "search_file": {
      const filePath = await resolveFilePath(args.vaultName as string, args.fileName as string);
      const query = (args.query as string).replace(/'/g, "'\\''");
      try {
        const { stdout } = await execAsync(
          `grep -n -e '${query}' '${filePath}'`,
          { timeout: 10_000 }
        );
        return stdout.trim() || "(no matches)";
      } catch (err: unknown) {
        const e = err as { code?: number };
        if (e.code === 1 || e.code === 2) return "(no matches)";
        throw err;
      }
    }

    case "get_file_contents": {
      const filePath = await resolveFilePath(args.vaultName as string, args.fileName as string);
      return await fs.readFile(filePath, "utf8");
    }

    case "create_new_file": {
      const filePath = await resolveFilePath(args.vaultName as string, args.fileName as string);
      const content = decodeContent(args.content as string);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return `Created: ${args.vaultName}/${args.fileName}`;
    }

    case "edit_file": {
      const filePath = await resolveFilePath(args.vaultName as string, args.fileName as string);
      const content = decodeContent(args.content as string);
      await fs.writeFile(filePath, content, "utf8");
      return `Edited: ${args.vaultName}/${args.fileName}`;
    }

    case "delete_file": {
      const filePath = await resolveFilePath(args.vaultName as string, args.fileName as string);
      await fs.rm(filePath, { recursive: true, force: true });
      return `Deleted: ${args.vaultName}/${args.fileName}`;
    }

    case "move_file": {
      const src = await resolveFilePath(args.vaultName as string, args.source as string);
      const dest = await resolveFilePath(args.vaultName as string, args.destination as string);
      await fs.rename(src, dest);
      return `Moved: ${args.vaultName}/${args.source} → ${args.vaultName}/${args.destination}`;
    }

    case "copy_file": {
      const src = await resolveFilePath(args.vaultName as string, args.source as string);
      const dest = await resolveFilePath(args.vaultName as string, args.destination as string);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      return `Copied: ${args.vaultName}/${args.source} → ${args.vaultName}/${args.destination}`;
    }

    case "make_folder": {
      const folderPath = await resolveFilePath(args.vaultName as string, args.folderName as string);
      await fs.mkdir(folderPath, { recursive: true });
      return `Folder created: ${args.vaultName}/${args.folderName}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
