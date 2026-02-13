const { spawn } = require('child_process');
const getLogger = require('../utils/logger');

/**
 * Claude executor
 */
class ClaudeExecutor {
  constructor(config, sessionStore = null, statsStore = null) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.statsStore = statsStore;
    this.logger = getLogger({
      logFile: config.logFile,
      logLevel: config.logLevel,
    });
  }

  /**
   * Execute Claude command
   */
  async execute(options) {
    const {
      prompt,
      projectPath,
      model = this.config.defaultModel,
      sessionId = null,
      systemPrompt = null,
      maxBudgetUsd = this.config.maxBudgetUsd,
      allowedTools = null,
      disallowedTools = null,
      agent = null,
      stream = false,
    } = options;

    // Budget control: check current session cost
    if (sessionId && maxBudgetUsd && this.sessionStore) {
      const session = await this.sessionStore.get(sessionId);
      if (session && session.total_cost_usd >= maxBudgetUsd) {
        this.logger.warn(`Budget exceeded for session`, {
          session_id: sessionId,
          current_cost: session.total_cost_usd,
          max_budget: maxBudgetUsd,
        });
        return {
          success: false,
          error: `Budget exceeded: session has already spent $${session.total_cost_usd.toFixed(2)} of $${maxBudgetUsd.toFixed(2)} limit`,
          budget_exceeded: true,
          current_cost_usd: session.total_cost_usd,
          max_budget_usd: maxBudgetUsd,
        };
      }
    }

    const startTime = Date.now();

    try {
      // Build command arguments
      const args = this.buildCommandArgs({
        prompt,
        model,
        sessionId,
        systemPrompt,
        maxBudgetUsd,
        allowedTools,
        disallowedTools,
        agent,
        mcpConfig: options.mcpConfig,
      });

      this.logger.info(`Executing Claude command`, {
        prompt: prompt.substring(0, 50) + '...',
        projectPath,
        model,
        args: args.join(' ').substring(0, 200) + '...',
      });

      // Execute asynchronously using spawn
      const result = await this.spawnCommand(projectPath, args);

      const duration = Date.now() - startTime;
      const costUsd = result.total_cost_usd || 0;

      this.logger.info(`Claude command succeeded`, {
        duration_ms: duration,
        cost_usd: costUsd,
        session_id: result.session_id,
      });

      // Budget control: check whether budget is exceeded after execution
      if (sessionId && maxBudgetUsd && this.sessionStore) {
        const session = await this.sessionStore.get(sessionId);
        const newTotalCost = (session?.total_cost_usd || 0) + costUsd;

        if (newTotalCost > maxBudgetUsd) {
          this.logger.warn(`Budget would be exceeded`, {
            session_id: sessionId,
            new_total: newTotalCost,
            max_budget: maxBudgetUsd,
          });

          return {
            success: false,
            error: `Budget would be exceeded: this request costs $${costUsd.toFixed(2)}, which would bring total to $${newTotalCost.toFixed(2)} exceeding the $${maxBudgetUsd.toFixed(2)} limit`,
            budget_exceeded: true,
            request_cost_usd: costUsd,
            current_cost_usd: session?.total_cost_usd || 0,
            max_budget_usd: maxBudgetUsd,
          };
        }
      }

      // Record statistics
      if (this.statsStore && this.config.statistics?.enabled) {
        await this.statsStore.recordRequest({
          success: true,
          model,
          cost_usd: costUsd,
          input_tokens: result.usage?.input_tokens || 0,
          output_tokens: result.usage?.output_tokens || 0,
        });
      }

      // Update session cost
      if (this.sessionStore && sessionId) {
        await this.sessionStore.addCost(sessionId, costUsd);
        await this.sessionStore.incrementMessages(sessionId);
      }

      return {
        success: true,
        result: result.result,
        duration_ms: duration,
        cost_usd: costUsd,
        session_id: result.session_id,
        usage: result.usage,
      };
    } catch (err) {
      const duration = Date.now() - startTime;

      this.logger.error(`Claude command failed`, {
        error: err.message,
        duration_ms: duration,
      });

      // Record failure statistics
      if (this.statsStore && this.config.statistics?.enabled) {
        await this.statsStore.recordRequest({
          success: false,
          model,
        });
      }

      return {
        success: false,
        error: err.message,
        duration_ms: duration,
      };
    }
  }

  /**
   * Execute command with spawn
   */
  spawnCommand(projectPath, args) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      env.PATH = `${this.config.nvmBin}:${env.PATH}`;

      // Decide whether to use IS_SANDBOX=1 environment variable based on config
      // This is used to bypass Claude CLI restrictions on --allow-dangerously-skip-permissions for root users
      if (this.config.enableRootCompatibility !== false) {
        env.IS_SANDBOX = '1';
        const isRunningAsRoot =
          typeof process.getuid === 'function' && process.getuid() === 0;
        if (isRunningAsRoot) {
          this.logger.warn(
            'Root compatibility mode enabled - using IS_SANDBOX=1 to bypass Claude CLI root restrictions',
          );
        }
      }

      const child = spawn(this.config.claudePath, args, {
        cwd: projectPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Timeout handling
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Command execution timeout'));
      }, 300000); // 5-minute timeout

      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = stdout || stderr;

        if (code !== 0) {
          return reject(
            new Error(`Command failed with code ${code}: ${output}`),
          );
        }

        if (!output || output.trim().length === 0) {
          return reject(new Error('Empty output from Claude CLI'));
        }

        try {
          const result = JSON.parse(output.trim());
          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse JSON output: ${err.message}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn command: ${err.message}`));
      });
    });
  }

  /**
   * Build command arguments array
   */
  buildCommandArgs(options) {
    const {
      prompt,
      model,
      sessionId,
      systemPrompt,
      maxBudgetUsd,
      allowedTools,
      disallowedTools,
      agent,
      mcpConfig,
    } = options;

    const args = ['-p', prompt, '--output-format', 'json'];

    // Add model
    if (model) {
      args.push('--model', model);
    }

    // Add session ID
    if (sessionId) {
      args.push('--session-id', sessionId);
    }

    // Add system prompt
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add budget limit
    if (maxBudgetUsd) {
      args.push('--max-budget-usd', maxBudgetUsd.toString());
    }

    // Add allowed tools
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowed-tools', allowedTools.join(','));
    }

    // Add disallowed tools
    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowed-tools', disallowedTools.join(','));
    }

    // Add agent
    if (agent) {
      args.push('--agent', agent);
    }

    // Add MCP config
    const mcpConfigPath =
      mcpConfig ||
      (this.config.mcp?.enabled ? this.config.mcp.configPath : null);
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }

    // Skip permission checks
    args.push('--allow-dangerously-skip-permissions');

    return args;
  }

  /**
   * Escape shell arguments (kept for potential shell commands)
   */
  escapeArg(arg) {
    return arg.replace(/'/g, "'\"'\"'");
  }
}

module.exports = ClaudeExecutor;
