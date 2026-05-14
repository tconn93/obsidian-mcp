# Obsidian-MCP

MCP server providing AI agents with sandboxed file management access to your Obsidian vaults. All paths are scoped to a configurable vaults directory — agents never see or touch raw filesystem paths.

## Features

- **Multi-vault support** — `VAULT_DIR_PATH` holds one or more vault directories (any directory containing a `.obsidian` folder is a vault)
- **Sandboxed access** — all operations use vault name + relative path; path traversal is blocked
- **Google OAuth** — optional authentication scoped by client ID, allowed emails, and/or allowed domains
- **HTML entity decoding** — `create_new_file` and `edit_file` auto-decode `&lt;`, `&gt;`, `&amp;`, `&#60;`, etc. so content from agent frameworks that HTML-encode arguments is written correctly
- **Dual transport** — HTTP server (default) or stdio mode for local MCP client spawning

## Tools

| Tool | Inputs | Description |
|---|---|---|
| `list_vaults` | _(none)_ | List all vault directories in `VAULT_DIR_PATH` |
| `get_vault_contents` | `vaultName` | Recursive listing; returns `{vaultName, contents: [{fileName}, ...]}` |
| `find_files` | `vaultName`, `query` | Find files by name glob (e.g. `*.md`) |
| `search_file` | `vaultName`, `fileName`, `query` | Grep a specific file for a pattern (regex) |
| `get_file_contents` | `vaultName`, `fileName` | Read a file's contents |
| `create_new_file` | `vaultName`, `fileName`, `content` | Create a file (auto-creates parent dirs, HTML-decodes) |
| `edit_file` | `vaultName`, `fileName`, `content` | Overwrite a file (HTML-decodes) |
| `delete_file` | `vaultName`, `fileName` | Delete a file or folder (recursive for folders) |
| `move_file` | `vaultName`, `source`, `destination` | Move or rename a file or folder |
| `copy_file` | `vaultName`, `source`, `destination` | Copy a file |
| `make_folder` | `vaultName`, `folderName` | Create a directory and any parent directories |

All paths are relative to the vault root. Agents use `vaultName` + `fileName` — never absolute paths.

## Quick Start

**Prerequisites:** Node.js 20+

```bash
npm install
npm run build
```

Copy `.env` and configure:

```env
PORT=8084
HOST=0.0.0.0

# Google OAuth — set GOOGLE_CLIENT_ID to enable auth; leave unset to disable
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_ALLOWED_EMAILS=you@example.com
GOOGLE_ALLOWED_DOMAINS=example.com

# Directory containing your Obsidian vaults
VAULT_DIR_PATH=/path/to/your/vaults
```

**Run:**

```bash
npm start                  # HTTP mode on PORT (default 8084)
node dist/index.js --stdio # Stdio mode for local MCP clients
```

## Auth

When `GOOGLE_CLIENT_ID` is set, all requests to `/mcp` require a valid Google OAuth access token in the `Authorization: Bearer <token>` header. Access can be further restricted:

- `GOOGLE_ALLOWED_EMAILS` — comma-separated list of allowed email addresses
- `GOOGLE_ALLOWED_DOMAINS` — comma-separated list of allowed email domains

If none are set, any valid token for the client ID is accepted. Token validation results are cached.

MCP clients discover the OAuth configuration at `/.well-known/oauth-authorization-server`.

## How It Works

`VAULT_DIR_PATH` is the parent directory containing your Obsidian vaults. Any subdirectory containing a `.obsidian` folder is treated as a vault.

For example, with `VAULT_DIR_PATH=/vaults`:

```
/vaults/
├── Personal/
│   ├── .obsidian/
│   ├── notes.md
│   └── journal/
│       └── 2026-05-14.md
└── Work/
    ├── .obsidian/
    └── projects.md
```

- `list_vaults` → `["Personal", "Work"]`
- `get_vault_contents` for `Personal` → `{vaultName: "Personal", contents: [{fileName: "notes.md"}, {fileName: "journal/2026-05-14.md"}]}`
- `get_file_contents` for vault `Personal`, file `journal/2026-05-14.md` → reads `/vaults/Personal/journal/2026-05-14.md`

Path traversal attempts (e.g. `fileName: "../../etc/passwd"`) are blocked.

## Endpoints

| Path | Method | Description |
|---|---|---|
| `/mcp` | POST | MCP endpoint (session init) |
| `/mcp` | GET/POST/DELETE | MCP endpoint (existing session) |
| `/health` | GET | Health check |
| `/.well-known/oauth-authorization-server` | GET | OAuth metadata discovery |

## License

MIT
