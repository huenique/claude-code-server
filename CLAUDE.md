# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Server is an HTTP API wrapper for the Anthropic Claude CLI. It provides enterprise-level features including session management, async task queues, statistics monitoring, webhook callbacks, and a TUI management tool.

**Tech Stack:** Node.js (>=18), Express, LowDB (JSON file storage), blessed (TUI)

## Development Commands

```bash
# Start the server directly
npm start
# or
node server.js

# Launch the TUI management tool (recommended for development)
npm run cli
# or
node cli.js

# Install dependencies
npm install
```

### Managing the Server via CLI

```bash
# Start/stop/status commands
node cli.js start    # Start the server as background process
node cli.js stop     # Stop the server
node cli.js status   # Check server status
```

### Testing the API

```bash
# Health check
curl http://localhost:5546/health

# Test Claude execution
curl -X POST http://localhost:5546/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain what HTTP is"}'
```

## Configuration

Configuration is stored at `~/.claude-code-server/config.json` (auto-generated on first run).

Key configuration options:
- `port`: Server port (default: 5546)
- `claudePath`: Path to Claude CLI executable
- `nvmBin`: NVM bin directory (for PATH setup)
- `defaultProjectPath`: Default workspace for Claude operations
- `logFile`, `pidFile`, `dataDir`: File paths for logs, PID, and data (all in `~/.claude-code-server/`)
- `taskQueue.concurrency`: Concurrent task limit (default: 3)
- `logFile`, `pidFile`, `dataDir`: File paths for logs, PID, and data
- `rateLimit`, `webhook`, `statistics`, `mcp`: Feature toggles

**Hot Reload:** Config changes are detected automatically and reloaded without restart.

## Architecture

### Entry Points

- **`server.js`**: Main HTTP server (Express). Loads config, initializes services, mounts routes.
- **`cli.js`**: TUI management tool using blessed. Controls server lifecycle and provides visual management.

### Layered Architecture

```
┌─────────────────────────────────────────┐
│         HTTP Routes (src/routes/)       │
│  - health.js, config.js, claude.js    │
│  - sessions.js, tasks.js, statistics.js │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│        Services (src/services/)         │
│  - claudeExecutor.js    (runs CLI)    │
│  - sessionManager.js    (sessions)     │
│  - taskQueue.js        (priority Q)   │
│  - rateLimiter.js      (rate limits)  │
│  - statisticsCollector.js              │
│  - webhookNotifier.js                 │
└────────────────┬───────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│        Storage (src/storage/)          │
│  - sessionStore.js                   │
│  - taskStore.js                      │
│  - statsStore.js                     │
│  All extend BaseStore (file locking)  │
└───────────────────────────────────────┘
```

### Key Services

**ClaudeExecutor** (`src/services/claudeExecutor.js`):
- Spawns Claude CLI as child process using `spawn()`
- Passes environment with NVM bin in PATH
- Returns JSON output parsed from stdout
- Tracks cost, duration, and usage statistics
- Budget checking before/after execution

**TaskQueue** (`src/services/taskQueue.js`):
- Priority-based task queue (1-10 priority levels)
- Configurable concurrency limit
- Persists tasks to TaskStore for recovery
- Emits events: `taskCompleted`, `taskFailed`, `taskCancelled`
- Triggers webhook notifications on completion

**SessionManager** (`src/services/sessionManager.js`):
- Multi-turn conversation sessions
- Stores cost and message count per session
- Session cleanup by retention days

### Storage Layer

All stores extend **BaseStore** (`src/storage/baseStore.js`):
- Uses LowDB with JSON file backend
- File locking mechanism for concurrent safety (`acquireLock`, `releaseLock`)
- `withLock()` wrapper for atomic write operations
- Data stored under `./data/` (configurable)

### Route Pattern

Routes are factory functions that receive dependencies:
```javascript
app.use('/api/claude', createClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager));
```

Each route handler:
1. Validates input with Joi validators
2. Calls service layer methods
3. Returns standardized responses: `{ success: true/false, ... }`

## Important Implementation Details

### Module Cache Reset
In `server.js`, service modules are cleared from require cache before initialization. This ensures configuration is reloaded correctly when the server restarts.

### Graceful Shutdown
The server handles SIGTERM/SIGINT:
1. Stops config file watcher
2. Stops statistics collector
3. Waits for active tasks to complete (10s timeout)
4. Closes HTTP server
5. Removes PID file

### Claude CLI Execution
- CLI is spawned with `--allow-dangerously-skip-permissions` flag
- Environment must include NVM bin in PATH for correct Node version
- Project path is used as `cwd` for the spawned process
- Timeout is 5 minutes (300000ms) by default

### Task State Machine
Task states: `pending` → `processing` → `completed`/`failed`/`cancelled`
On server restart, `processing` tasks are reset to `pending`

## File Locations

- Config: `~/.claude-code-server/config.json`
- Logs: `~/.claude-code-server/logs/server.log`
- PID file: `~/.claude-code-server/server.pid`
- Data: `./data/` (sessions, tasks, statistics JSON files)
