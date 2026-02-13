#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration directory and file
const configDir = path.join(
  process.env.HOME || os.homedir(),
  '.claude-code-server',
);
const configPath = path.join(configDir, 'config.json');
const defaultConfig = {
  port: 5546,
  host: '0.0.0.0',
  claudePath: path.join(
    process.env.HOME || os.homedir(),
    '.nvm',
    'versions',
    'node',
    'v22.21.0',
    'bin',
    'claude',
  ),
  nvmBin: path.join(
    process.env.HOME || os.homedir(),
    '.nvm',
    'versions',
    'node',
    'v22.21.0',
    'bin',
  ),
  defaultProjectPath: path.join(process.env.HOME || os.homedir(), 'workspace'),
  logFile: path.join(
    process.env.HOME || os.homedir(),
    '.claude-code-server',
    'logs',
    'server.log',
  ),
  pidFile: path.join(
    process.env.HOME || os.homedir(),
    '.claude-code-server',
    'server.pid',
  ),
  dataDir: path.join(
    process.env.HOME || os.homedir(),
    '.claude-code-server',
    'data',
  ),
  sessionRetentionDays: 30,
  taskQueue: {
    concurrency: 3,
    defaultTimeout: 300000,
  },
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
  },
  defaultModel: 'claude-sonnet-4-5',
  maxBudgetUsd: 10.0,
  webhook: {
    enabled: false,
    defaultUrl: null,
    timeout: 5000,
    retries: 3,
  },
  statistics: {
    enabled: true,
    collectionInterval: 60000,
  },
  mcp: {
    enabled: false,
    configPath: null,
  },
  logLevel: 'info',
  enableRootCompatibility: true,
};

// Ensure config directory exists and load config
function loadConfig() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    // Create default config file
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(chalk.yellow(`Default config file created: ${configPath}`));
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

let config = loadConfig();

// Log and PID file paths
const pidFile = config.pidFile;
const logFile = config.logFile;

// Check whether the service is running
function isServerRunning() {
  try {
    if (!fs.existsSync(pidFile)) {
      return { running: false };
    }

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());

    // Check whether the process exists
    try {
      process.kill(pid, 0); // Send signal 0 to check if process exists
      return { running: true, pid };
    } catch (e) {
      // PID file exists but process does not
      fs.unlinkSync(pidFile);
      return { running: false };
    }
  } catch (e) {
    return { running: false };
  }
}

// Start service
async function startServer() {
  const { running, pid } = isServerRunning();

  if (running) {
    console.log(
      chalk.yellow('✓ Service is already running (PID: ' + pid + ')'),
    );
    return;
  }

  const spinner = ora('Starting Claude Code service...').start();

  try {
    // Ensure log directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(chalk.gray(`✅ Created log directory: ${logDir}`));
      } catch (err) {
        console.error(
          chalk.red(
            `❌ Failed to create log directory ${logDir}:`,
            err.message,
          ),
        );
      }
    }

    // Start background process in detached mode
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const child = spawn('node', ['server.js'], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: 'production', // Set production mode to disable console logs
        CLAUDE_BACKGROUND: 'true', // Additional background mode marker
      },
    });

    // Detach child process
    child.unref();

    // Wait briefly for process startup
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check whether startup succeeded
    const { running: nowRunning } = isServerRunning();
    if (nowRunning) {
      spinner.succeed(chalk.green('Service started successfully!'));
      console.log(chalk.gray(`  Port: ${config.port}`));
      console.log(chalk.gray(`  Log: ${logFile}`));
      console.log(
        chalk.cyan(`\nTest: curl http://localhost:${config.port}/health`),
      );
    } else {
      spinner.fail('Service failed to start, please check log: ' + logFile);
    }
  } catch (error) {
    spinner.fail('Startup failed: ' + error.message);
  }
}

// Stop service
async function stopServer() {
  const { running, pid } = isServerRunning();

  if (!running) {
    console.log(chalk.yellow('○ Service is not running'));
    return;
  }

  const spinner = ora(`Stopping service (PID: ${pid})...`).start();

  try {
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit
    let retries = 10;
    while (retries > 0 && isServerRunning().running) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries--;
    }

    // If still running, force kill
    if (isServerRunning().running) {
      process.kill(pid, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Remove PID file
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    spinner.succeed(chalk.green('Service stopped'));
  } catch (error) {
    spinner.fail('Stop failed: ' + error.message);
  }
}

// View status
async function showStatus() {
  const { running, pid } = isServerRunning();

  console.log('');
  console.log(chalk.bold('┌─────────────────────────────────────┐'));
  console.log(chalk.bold('│     Claude Code Server Status       │'));
  console.log(chalk.bold('├─────────────────────────────────────┤'));

  if (running) {
    // Get process uptime
    try {
      const stats = fs.statSync(logFile);
      const startTime = stats.mtime;
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      console.log(
        chalk.bold('│ ') + chalk.green('● ') + chalk.white('Status: Running'),
      );
      console.log(chalk.bold('│ ') + chalk.white(`   PID: ${pid}`));
      console.log(chalk.bold('│ ') + chalk.white(`   Port: ${config.port}`));
      console.log(
        chalk.bold('│ ') + chalk.white(`   Uptime: ${hours}h ${minutes}m`),
      );
      console.log(chalk.bold('│ ') + chalk.white(`   Log: ${logFile}`));
    } catch (e) {
      console.log(
        chalk.bold('│ ') + chalk.green('● ') + chalk.white('Status: Running'),
      );
      console.log(chalk.bold('│ ') + chalk.white(`   PID: ${pid}`));
      console.log(chalk.bold('│ ') + chalk.white(`   Port: ${config.port}`));
    }
  } else {
    console.log(
      chalk.bold('│ ') + chalk.gray('○ ') + chalk.white('Status: Not running'),
    );
    console.log(
      chalk.bold('│ ') + chalk.white(`   Port: ${config.port} (config)`),
    );
    console.log(chalk.bold('│ ') + chalk.white(`   Log: ${logFile}`));
  }

  console.log(chalk.bold('└─────────────────────────────────────┘'));
  console.log('');
}

// View logs
async function viewLogs() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(
      chalk.yellow('Service is not running; logs may not be up to date'),
    );
  }

  // Log viewer menu
  while (true) {
    // Clear screen and display logs
    console.clear();
    console.log(chalk.bold.cyan(`📋 Log Viewer - ${logFile}`));
    console.log(chalk.gray('='.repeat(60)));
    console.log('');

    try {
      // Read last 20 log lines (use stdio: 'pipe' to avoid direct terminal output)
      const { execSync } = require('child_process');
      const lastLines = execSync(`tail -n 20 ${logFile}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      // Parse and format logs
      const lines = lastLines.split('\n').filter((line) => line.trim());
      lines.forEach((line) => {
        try {
          const log = JSON.parse(line);
          const level = log.level || 'info';
          const timestamp = log.timestamp || '';
          const message = log.message || '';

          // Set color based on level
          let colorFn = chalk.white;
          if (level === 'error') colorFn = chalk.red;
          else if (level === 'warn') colorFn = chalk.yellow;
          else if (level === 'info') colorFn = chalk.green;

          console.log(colorFn(`[${timestamp}] ${message}`));

          // If extra metadata exists, show key details
          if (log.task_id)
            console.log(
              chalk.gray(`  Task: ${log.task_id.substring(0, 8)}...`),
            );
          if (log.session_id)
            console.log(
              chalk.gray(`  Session: ${log.session_id.substring(0, 8)}...`),
            );
          if (log.cost_usd !== undefined)
            console.log(chalk.gray(`  Cost: $${log.cost_usd.toFixed(4)}`));
        } catch (e) {
          // If not JSON format, display directly
          console.log(chalk.gray(line));
        }
      });
    } catch (error) {
      console.log(chalk.yellow('Unable to read log or log is empty'));
    }

    console.log('');
    console.log(chalk.gray('='.repeat(60)));

    // Provide action options
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '🔄 Refresh logs', value: 'refresh' },
          { name: '📄 View more (last 50 lines)', value: 'more' },
          { name: '🔍 Search logs', value: 'search' },
          { name: '◀ Back to main menu', value: 'back' },
        ],
      },
    ]);

    if (action === 'back') {
      break;
    } else if (action === 'more') {
      // View more logs
      console.clear();
      console.log(chalk.bold.cyan(`📋 Last 50 Log Lines - ${logFile}`));
      console.log(chalk.gray('='.repeat(60)));
      console.log('');

      try {
        const { execSync } = require('child_process');
        const lastLines = execSync(`tail -n 50 ${logFile}`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        const lines = lastLines.split('\n').filter((line) => line.trim());
        lines.forEach((line) => {
          try {
            const log = JSON.parse(line);
            const level = log.level || 'info';
            const timestamp = log.timestamp || '';
            const message = log.message || '';

            let colorFn = chalk.white;
            if (level === 'error') colorFn = chalk.red;
            else if (level === 'warn') colorFn = chalk.yellow;
            else if (level === 'info') colorFn = chalk.green;

            console.log(colorFn(`[${timestamp}] ${message}`));
          } catch (e) {
            console.log(chalk.gray(line));
          }
        });
      } catch (error) {
        console.log(chalk.yellow('Unable to read logs'));
      }

      console.log('');
      await inquirer.prompt([
        {
          type: 'input',
          name: 'continue',
          message: 'Press Enter to return...',
        },
      ]);
    } else if (action === 'search') {
      // Search logs
      const { keyword } = await inquirer.prompt([
        {
          type: 'input',
          name: 'keyword',
          message: 'Enter search keyword:',
        },
      ]);

      if (keyword) {
        console.clear();
        console.log(
          chalk.bold.cyan(`🔍 Search results: "${keyword}" - ${logFile}`),
        );
        console.log(chalk.gray('='.repeat(60)));
        console.log('');

        try {
          const { execSync } = require('child_process');
          const result = execSync(
            `grep -i "${keyword}" ${logFile} | tail -n 20`,
            {
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
            },
          );

          if (result.trim()) {
            const lines = result.split('\n').filter((line) => line.trim());
            lines.forEach((line) => {
              try {
                const log = JSON.parse(line);
                const timestamp = log.timestamp || '';
                const message = log.message || '';
                console.log(
                  chalk.gray(`[${timestamp}]`) + chalk.white(` ${message}`),
                );
              } catch (e) {
                console.log(chalk.gray(line));
              }
            });
          } else {
            console.log(chalk.yellow('No matching logs found'));
          }
        } catch (error) {
          console.log(chalk.yellow('Search failed or no results found'));
        }

        console.log('');
        await inquirer.prompt([
          {
            type: 'input',
            name: 'continue',
            message: 'Press Enter to return...',
          },
        ]);
      }
    }
    // refresh: continue loop and redisplay logs
  }

  // Clear screen before returning
  console.clear();
}

// Configuration management
async function configureSettings() {
  // Part 1: Basic configuration
  const basicAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'port',
      message: 'Service port:',
      default: config.port,
    },
    {
      type: 'input',
      name: 'host',
      message: 'Listen address:',
      default: config.host,
    },
    {
      type: 'input',
      name: 'claudePath',
      message: 'Claude path:',
      default: config.claudePath,
    },
    {
      type: 'input',
      name: 'nvmBin',
      message: 'NVM bin path:',
      default: config.nvmBin,
    },
    {
      type: 'input',
      name: 'defaultProjectPath',
      message: 'Default project path:',
      default: config.defaultProjectPath,
    },
  ]);

  // Update basic configuration
  Object.assign(config, basicAnswers);

  // Part 2: Root compatibility configuration
  const { enableRootCompatibility } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableRootCompatibility',
      message:
        'Enable root compatibility mode? (bypass Claude CLI root restrictions)',
      default: config.enableRootCompatibility !== false,
    },
  ]);

  // Update root compatibility configuration
  config.enableRootCompatibility = enableRootCompatibility;

  // Part 3: Webhook configuration
  const { enableWebhook } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableWebhook',
      message: 'Enable Webhook callback?',
      default: config.webhook?.enabled || false,
    },
  ]);

  if (enableWebhook) {
    const webhookAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'webhookUrl',
        message: 'Webhook URL:',
        default: config.webhook?.defaultUrl || '',
        validate: (input) => {
          if (!input) return true; // Empty is allowed
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'input',
        name: 'webhookTimeout',
        message: 'Webhook timeout (ms):',
        default: (config.webhook?.timeout || 5000).toString(),
        filter: (input) => parseInt(input),
      },
      {
        type: 'input',
        name: 'webhookRetries',
        message: 'Webhook retry count:',
        default: (config.webhook?.retries || 3).toString(),
        filter: (input) => parseInt(input),
      },
    ]);

    // Update Webhook configuration
    config.webhook = {
      enabled: true,
      defaultUrl: webhookAnswers.webhookUrl || null,
      timeout: webhookAnswers.webhookTimeout,
      retries: webhookAnswers.webhookRetries,
    };
  } else {
    config.webhook = {
      enabled: false,
      defaultUrl: null,
      timeout: 5000,
      retries: 3,
    };
  }

  // Part 4: Task queue configuration
  const queueAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'concurrency',
      message: 'Task queue concurrency (1-10):',
      default: (config.taskQueue?.concurrency || 3).toString(),
      validate: (input) => {
        const num = parseInt(input);
        if (isNaN(num) || num < 1 || num > 10) {
          return 'Please enter a number between 1 and 10';
        }
        return true;
      },
      filter: (input) => parseInt(input),
    },
    {
      type: 'input',
      name: 'timeout',
      message: 'Task timeout (ms):',
      default: (config.taskQueue?.defaultTimeout || 300000).toString(),
      filter: (input) => parseInt(input),
    },
  ]);

  config.taskQueue = {
    concurrency: queueAnswers.concurrency,
    defaultTimeout: queueAnswers.timeout,
  };

  // Save configuration
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green('✓ Configuration saved'));
  console.log(
    chalk.cyan('ℹ Configuration will auto-apply in 1 second (hot reload)'),
  );

  // Show configuration summary
  console.log('');
  console.log(chalk.bold.cyan('Configuration Summary:'));
  console.log(`  ${chalk.white('Port:')} ${config.port}`);
  console.log(
    `  ${chalk.white('Root Compatibility:')} ${config.enableRootCompatibility !== false ? chalk.green('Enabled') : chalk.gray('Disabled')}`,
  );
  console.log(
    `  ${chalk.white('Webhook:')} ${config.webhook.enabled ? chalk.green('Enabled') : chalk.gray('Disabled')}`,
  );
  if (config.webhook.enabled && config.webhook.defaultUrl) {
    console.log(`  ${chalk.white('URL:')} ${config.webhook.defaultUrl}`);
  }
  console.log(
    `  ${chalk.white('Task Queue:')} concurrency ${config.taskQueue?.concurrency || 3}, timeout ${config.taskQueue?.defaultTimeout || 300000}ms`,
  );
  console.log('');
}

// Show API documentation
async function showApiDocs() {
  console.log('');
  console.log(
    chalk.bold.cyan(
      '╔════════════════════════════════════════════════════════════════╗',
    ),
  );
  console.log(
    chalk.bold.cyan(
      '║           Claude Code Server - API Documentation              ║',
    ),
  );
  console.log(
    chalk.bold.cyan(
      '╚════════════════════════════════════════════════════════════════╝',
    ),
  );
  console.log('');

  console.log(
    chalk.bold.yellow('Base URL: ') +
      chalk.white(`http://localhost:${config.port}`),
  );
  console.log('');

  // 1. Health check
  console.log(chalk.bold.green('1. Health Check'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('GET /health'));
  console.log('');
  console.log(
    chalk.white('Description: ') +
      'Check whether the service is running normally',
  );
  console.log(chalk.white('Response:'));
  console.log('  {');
  console.log('    "status": "ok",');
  console.log('    "uptime": 123.45');
  console.log('  }');
  console.log('');

  // 2. Claude API
  console.log(chalk.bold.green('2. Claude AI Chat'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('POST /api/claude'));
  console.log('');
  console.log(
    chalk.white('Description: ') +
      'Send a prompt to Claude AI and get a response',
  );
  console.log('');
  console.log(chalk.white('Request Body:'));
  console.log('  {');
  console.log(
    `    "prompt": "your question or task",${chalk.gray('    // required')}`,
  );
  console.log(
    `    "project_path": "/path/to/project"${chalk.gray(' // optional, default: ' + config.defaultProjectPath + ')')}`,
  );
  console.log('  }');
  console.log('');
  console.log(chalk.white('Response (Success):'));
  console.log('  {');
  console.log('    "success": true,');
  console.log('    "result": "Claude response text",');
  console.log('    "duration_ms": 1953,');
  console.log('    "cost_usd": 0.097502,');
  console.log('    "session_id": "xxx-xxx-xxx"');
  console.log('  }');
  console.log('');
  console.log(chalk.white('Response (Failure):'));
  console.log('  {');
  console.log('    "success": false,');
  console.log('    "error": "Error message",');
  console.log('    "duration_ms": 100');
  console.log('  }');
  console.log('');

  // 3. Configuration info
  console.log(chalk.bold.green('3. Configuration Info'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('GET /api/config'));
  console.log('');
  console.log(chalk.white('Description: ') + 'Get service configuration info');
  console.log(chalk.white('Response:'));
  console.log('  {');
  console.log('    "port": 5546,');
  console.log('    "defaultProjectPath": "/home/junhang/workspace",');
  console.log('    "version": "1.0.0"');
  console.log('  }');
  console.log('');

  // 4. Usage examples
  console.log(chalk.bold.green('4. Usage Examples'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('curl example:'));
  console.log('');
  console.log(chalk.gray('# health check'));
  console.log(chalk.white(`curl http://localhost:${config.port}/health`));
  console.log('');
  console.log(chalk.gray('# call Claude'));
  console.log(
    chalk.white(`curl -X POST http://localhost:${config.port}/api/claude \\`),
  );
  console.log(chalk.white('  -H "Content-Type: application/json" \\'));
  console.log(chalk.white('  -d \'{"prompt": "Explain what HTTP is"}\''));
  console.log('');
  console.log(chalk.cyan('Node.js example:'));
  console.log('');
  console.log(
    'const response = await fetch(`http://localhost:' +
      config.port +
      '/api/claude`, {',
  );
  console.log('  method: "POST",');
  console.log('  headers: { "Content-Type": "application/json" },');
  console.log('  body: JSON.stringify({ prompt: "your question" })');
  console.log('});');
  console.log('const data = await response.json();');
  console.log('console.log(data.result);');
  console.log('');

  console.log(chalk.gray('═'.repeat(60)));
  console.log('');
}

// Test API
async function testApi() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first'));
    return;
  }

  const spinner = ora('Testing API...').start();

  try {
    const response = await fetch(`http://localhost:${config.port}/health`);
    const data = await response.json();

    spinner.succeed(chalk.green('Health check passed'));
    console.log(JSON.stringify(data, null, 2));

    // Test Claude Code API
    const spinner2 = ora('Testing Claude Code API...').start();
    const claudeResponse = await fetch(
      `http://localhost:${config.port}/api/claude`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Say hello' }),
      },
    );
    const claudeData = await claudeResponse.json();

    if (claudeData.success) {
      spinner2.succeed(chalk.green('Claude Code API test succeeded'));
      console.log(chalk.gray('Reply: ') + claudeData.result);
      console.log(
        chalk.gray(
          `Duration: ${claudeData.duration_ms}ms, Cost: $${claudeData.cost_usd}`,
        ),
      );
    } else {
      spinner2.warn(chalk.yellow('Claude Code API returned an error'));
      console.log(JSON.stringify(claudeData, null, 2));
    }
  } catch (error) {
    spinner.fail('Test failed: ' + error.message);
  }
}

// ========== Session Management ==========

// List all sessions
async function listSessions() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first.'));
    return;
  }

  const spinner = ora('Fetching session list...').start();

  try {
    const response = await fetch(
      `http://localhost:${config.port}/api/sessions`,
    );
    const data = await response.json();

    spinner.stop();

    if (data.success && data.sessions.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`Found ${data.sessions.length} sessions:`));
      console.log('');

      data.sessions.forEach((session, index) => {
        const statusColor =
          session.status === 'active' ? chalk.green : chalk.gray;
        console.log(
          `${chalk.bold(index + 1 + '.')} ${chalk.white(session.id.substring(0, 8))}... - ${statusColor('● ' + session.status)}`,
        );
        console.log(`   ${chalk.gray('Project:')} ${session.project_path}`);
        console.log(`   ${chalk.gray('Model:')} ${session.model}`);
        console.log(
          `   ${chalk.gray('Messages:')} ${session.messages_count} | ${chalk.gray('Cost:')} $${session.total_cost_usd.toFixed(4)}`,
        );
        console.log(
          `   ${chalk.gray('Created:')} ${new Date(session.created_at).toLocaleString()}`,
        );
        console.log('');
      });
    } else {
      spinner.warn('No sessions found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch session list: ' + error.message);
  }
}

// View session details
async function viewSessionDetails() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first.'));
    return;
  }

  const spinner = ora('Fetching session list...').start();

  try {
    const response = await fetch(
      `http://localhost:${config.port}/api/sessions`,
    );
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.sessions.length === 0) {
      console.log(chalk.yellow('No sessions found'));
      return;
    }

    const choices = data.sessions.map((s) => ({
      name: `${s.id.substring(0, 8)}... - ${s.project_path} (${s.status})`,
      value: s.id,
    }));

    const { sessionId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sessionId',
        message: 'Select a session to view:',
        choices,
      },
    ]);

    const spinner2 = ora('Fetching session details...').start();
    const detailResponse = await fetch(
      `http://localhost:${config.port}/api/sessions/${sessionId}`,
    );
    const detailData = await detailResponse.json();

    spinner2.stop();

    if (detailData.success) {
      const session = detailData.session;
      console.log('');
      console.log(chalk.bold.cyan('Session details:'));
      console.log('');
      console.log(`${chalk.white('ID:')}            ${session.id}`);
      console.log(`${chalk.white('Status:')}        ${session.status}`);
      console.log(`${chalk.white('Project Path:')}  ${session.project_path}`);
      console.log(`${chalk.white('Model:')}         ${session.model}`);
      console.log(`${chalk.white('Messages:')}      ${session.messages_count}`);
      console.log(
        `${chalk.white('Total Cost:')}    $${session.total_cost_usd.toFixed(4)}`,
      );
      console.log(
        `${chalk.white('Created At:')}    ${new Date(session.created_at).toLocaleString()}`,
      );
      console.log(
        `${chalk.white('Updated At:')}    ${new Date(session.updated_at).toLocaleString()}`,
      );
      if (session.metadata && Object.keys(session.metadata).length > 0) {
        console.log(
          `${chalk.white('Metadata:')}      ${JSON.stringify(session.metadata)}`,
        );
      }
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch session details'));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Delete session
async function deleteSession() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first.'));
    return;
  }

  const spinner = ora('Fetching session list...').start();

  try {
    const response = await fetch(
      `http://localhost:${config.port}/api/sessions`,
    );
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.sessions.length === 0) {
      console.log(chalk.yellow('No sessions found'));
      return;
    }

    const choices = data.sessions.map((s) => ({
      name: `${s.id.substring(0, 8)}... - ${s.project_path} (${s.status})`,
      value: s.id,
    }));

    const { sessionId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sessionId',
        message: 'Select a session to delete:',
        choices,
      },
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confirm deleting this session?',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('Canceled'));
      return;
    }

    const spinner2 = ora('Deleting session...').start();
    const deleteResponse = await fetch(
      `http://localhost:${config.port}/api/sessions/${sessionId}`,
      {
        method: 'DELETE',
      },
    );
    const deleteData = await deleteResponse.json();

    spinner2.stop();

    if (deleteData.success) {
      console.log(chalk.green('✓ Session deleted'));
    } else {
      console.log(chalk.red('Delete failed: ' + deleteData.error));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Session management menu
async function sessionManagementMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Session Management',
      pageSize: 10,
      choices: [
        { name: '📜 List all sessions', value: 'list' },
        { name: '🔍 View session details', value: 'view' },
        { name: '🗑 Delete session', value: 'delete' },
        { name: '◀ Back to main menu', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'list':
      await listSessions();
      break;
    case 'view':
      await viewSessionDetails();
      break;
    case 'delete':
      await deleteSession();
      break;
    case 'back':
      return;
  }

  console.log('');
  await sessionManagementMenu();
}

// ========== Statistics View ==========

// View statistics summary
async function viewStatisticsSummary() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first'));
    return;
  }

  const spinner = ora('Fetching statistics...').start();

  try {
    const response = await fetch(
      `http://localhost:${config.port}/api/statistics/summary`,
    );
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const stats = data.statistics;
      console.log('');
      console.log(chalk.bold.cyan('Usage statistics summary:'));
      console.log('');
      console.log(`${chalk.white('Total Requests:')} ${stats.requests.total}`);
      console.log(
        `${chalk.green('Successful:')}     ${stats.requests.successful}`,
      );
      console.log(`${chalk.red('Failed:')}         ${stats.requests.failed}`);
      console.log(`${chalk.white('Token Usage:')}`);
      console.log(
        `  ${chalk.gray('- Input:')}      ${stats.tokens.total_input.toLocaleString()}`,
      );
      console.log(
        `  ${chalk.gray('- Output:')}     ${stats.tokens.total_output.toLocaleString()}`,
      );
      console.log(
        `${chalk.white('Total Cost:')}    $${stats.costs.total_usd.toFixed(4)}`,
      );
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch statistics'));
    }
  } catch (error) {
    spinner.fail('Failed to fetch statistics: ' + error.message);
  }
}

// View daily statistics
async function viewDailyStatistics() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first'));
    return;
  }

  const spinner = ora('Fetching daily statistics...').start();

  try {
    const response = await fetch(
      `http://localhost:${config.port}/api/statistics/daily?limit=7`,
    );
    const data = await response.json();

    spinner.stop();

    if (data.success && data.daily.length > 0) {
      console.log('');
      console.log(
        chalk.bold.cyan(`Daily stats for the last ${data.daily.length} days:`),
      );
      console.log('');

      data.daily.forEach((day, index) => {
        console.log(`${chalk.bold(index + 1 + '.')} ${chalk.white(day.date)}`);
        console.log(
          `   ${chalk.gray('Requests:')} ${day.total_requests} | ${chalk.gray('Success:')} ${day.successful_requests} | ${chalk.gray('Failed:')} ${day.failed_requests}`,
        );
        console.log(
          `   ${chalk.gray('Cost:')} $${day.total_cost_usd.toFixed(4)} | ${chalk.gray('Input Tokens:')} ${day.total_input_tokens.toLocaleString()} | ${chalk.gray('Output Tokens:')} ${day.total_output_tokens.toLocaleString()}`,
        );
        console.log('');
      });
    } else {
      spinner.warn('No statistics found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch statistics: ' + error.message);
  }
}

// Statistics view menu
async function statisticsMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Statistics',
      choices: [
        { name: '📊 View summary', value: 'summary' },
        { name: '📅 View daily stats', value: 'daily' },
        { name: '◀ Back to main menu', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'summary':
      await viewStatisticsSummary();
      break;
    case 'daily':
      await viewDailyStatistics();
      break;
    case 'back':
      return;
  }

  console.log('');
  await statisticsMenu();
}

// ========== Task List ==========

// List all tasks
async function listTasks() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first'));
    return;
  }

  const spinner = ora('Fetching task list...').start();

  try {
    const response = await fetch(`http://localhost:${config.port}/api/tasks`);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.tasks.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`Found ${data.tasks.length} tasks:`));
      console.log('');

      data.tasks.forEach((task, index) => {
        const statusColors = {
          pending: chalk.yellow,
          processing: chalk.blue,
          completed: chalk.green,
          failed: chalk.red,
          cancelled: chalk.gray,
        };
        const statusColor = statusColors[task.status] || chalk.gray;

        console.log(
          `${chalk.bold(index + 1 + '.')} ${chalk.white(task.id.substring(0, 8))}... - ${statusColor('● ' + task.status)} ${chalk.gray('(Priority: ' + task.priority + ')')}`,
        );
        console.log(
          `   ${chalk.gray('Prompt:')} ${task.prompt.substring(0, 60)}${task.prompt.length > 60 ? '...' : ''}`,
        );
        if (task.status === 'completed') {
          console.log(
            `   ${chalk.green('Result:')} ${task.result?.substring(0, 60)}${task.result?.length > 60 ? '...' : ''}`,
          );
          console.log(
            `   ${chalk.gray('Duration:')} ${task.duration_ms}ms | ${chalk.gray('Cost:')} $${task.cost_usd.toFixed(4)}`,
          );
        } else if (task.status === 'failed') {
          console.log(`   ${chalk.red('Error:')} ${task.error}`);
        }
        console.log(
          `   ${chalk.gray('Created:')} ${new Date(task.created_at).toLocaleString()}`,
        );
        console.log('');
      });
    } else {
      spinner.warn('No tasks found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch task list: ' + error.message);
  }
}

// View queue status
async function viewQueueStatus() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first'));
    return;
  }

  const spinner = ora('Fetching queue status...').start();

  try {
    const response = await fetch(
      `http://localhost:${config.port}/api/tasks/queue/status`,
    );
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const queue = data.queue;
      console.log('');
      console.log(chalk.bold.cyan('Task queue status:'));
      console.log('');
      console.log(
        `${chalk.white('Running:')}       ${queue.running ? chalk.green('Yes') : chalk.gray('No')}`,
      );
      console.log(`${chalk.white('Concurrency:')}   ${queue.concurrency}`);
      console.log(`${chalk.white('Active Tasks:')}  ${queue.active_tasks}`);
      console.log(`${chalk.white('Task Stats:')}`);
      console.log(`  ${chalk.gray('- Total:')}     ${queue.total}`);
      console.log(`  ${chalk.yellow('- Pending:')}   ${queue.pending}`);
      console.log(`  ${chalk.blue('- Processing:')} ${queue.processing}`);
      console.log(`  ${chalk.green('- Completed:')}  ${queue.completed}`);
      console.log(`  ${chalk.red('- Failed:')}      ${queue.failed}`);
      console.log(`  ${chalk.gray('- Cancelled:')}  ${queue.cancelled}`);
      console.log(
        `  ${chalk.gray('- Total Cost:')} $${queue.total_cost_usd.toFixed(4)}`,
      );
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch queue status'));
    }
  } catch (error) {
    spinner.fail('Failed to fetch queue status: ' + error.message);
  }
}

// Adjust task priority
async function changeTaskPriority() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Please start it first'));
    return;
  }

  const spinner = ora('Fetching pending tasks...').start();

  try {
    // Get tasks in pending and processing states
    const response = await fetch(
      `http://localhost:${config.port}/api/tasks?status=pending`,
    );
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.tasks.length === 0) {
      console.log(chalk.yellow('No tasks available for priority adjustment'));
      return;
    }

    // Let user choose a task
    const choices = data.tasks.map((task) => ({
      name: `${task.id.substring(0, 8)}... - Priority: ${task.priority} - ${task.prompt.substring(0, 50)}...`,
      value: task.id,
      short: task.id.substring(0, 8),
    }));

    const { taskId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskId',
        message: 'Select a task to adjust priority:',
        choices: choices,
      },
    ]);

    const task = data.tasks.find((t) => t.id === taskId);

    // Let user input a new priority
    const { priority } = await inquirer.prompt([
      {
        type: 'input',
        name: 'priority',
        message: `Enter new priority (1-10, current: ${task.priority}):`,
        default: task.priority.toString(),
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1 || num > 10) {
            return 'Please enter a number between 1 and 10';
          }
          return true;
        },
        filter: (input) => parseInt(input),
      },
    ]);

    // Update priority
    const updateSpinner = ora('Updating priority...').start();
    const updateResponse = await fetch(
      `http://localhost:${config.port}/api/tasks/${taskId}/priority`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
      },
    );

    const updateData = await updateResponse.json();
    updateSpinner.stop();

    if (updateData.success) {
      console.log('');
      console.log(chalk.green('✓ Priority updated'));
      console.log(`  Task ID: ${updateData.task_id.substring(0, 8)}...`);
      console.log(`  Old Priority: ${updateData.old_priority}`);
      console.log(`  New Priority: ${updateData.new_priority}`);
      console.log('');
    } else {
      console.log(chalk.red('✗ Update failed: ' + updateData.error));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Task list menu
async function tasksMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Task List',
      pageSize: 10,
      choices: [
        { name: '📜 List all tasks', value: 'list' },
        { name: '📊 View queue status', value: 'status' },
        { name: '⚡ Adjust task priority', value: 'priority' },
        { name: '◀ Back to main menu', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'list':
      await listTasks();
      break;
    case 'status':
      await viewQueueStatus();
      break;
    case 'priority':
      await changeTaskPriority();
      break;
    case 'back':
      return;
  }

  console.log('');
  await tasksMenu();
}

// Main menu
async function mainMenu() {
  const { running, pid } = isServerRunning();

  const statusText = running
    ? chalk.green('[Running]')
    : chalk.gray('[Stopped]');
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `Claude Code Server Manager ${statusText}`,
      pageSize: 15, // Set number of visible menu rows
      choices: [
        {
          name: '▶ Start Service',
          value: 'start',
          disabled: running ? 'Already running' : false,
        },
        {
          name: '■ Stop Service',
          value: 'stop',
          disabled: !running ? 'Not running' : false,
        },
        { name: '● View Status', value: 'status' },
        {
          name: '💬 Session Management',
          value: 'sessions',
          disabled: !running ? 'Service not running' : false,
        },
        {
          name: '📊 View Statistics',
          value: 'statistics',
          disabled: !running ? 'Service not running' : false,
        },
        {
          name: '📋 Task List',
          value: 'tasks',
          disabled: !running ? 'Service not running' : false,
        },
        {
          name: '📋 View Logs (tail -f)',
          value: 'logs',
          disabled: !fs.existsSync(logFile) ? 'No log file' : false,
        },
        { name: '📖 View API Docs', value: 'docs' },
        { name: '⚙ Configuration', value: 'config' },
        {
          name: '🧪 Test API',
          value: 'test',
          disabled: !running ? 'Service not running' : false,
        },
        { name: '✖ Exit', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'start':
      await startServer();
      break;
    case 'stop':
      await stopServer();
      break;
    case 'status':
      await showStatus();
      break;
    case 'sessions':
      await sessionManagementMenu();
      break;
    case 'statistics':
      await statisticsMenu();
      break;
    case 'tasks':
      await tasksMenu();
      break;
    case 'logs':
      await viewLogs();
      break;
    case 'docs':
      await showApiDocs();
      break;
    case 'config':
      await configureSettings();
      break;
    case 'test':
      await testApi();
      break;
    case 'exit':
      console.log(chalk.gray('Goodbye!'));
      process.exit(0);
  }

  console.log('');
  await mainMenu();
}

// Command-line argument handling
const args = process.argv.slice(2);

if (args.length === 0) {
  // Interactive menu
  mainMenu().catch(console.error);
} else {
  // Command-line mode
  const command = args[0];

  switch (command) {
    case 'start':
      startServer().then(() => process.exit(0));
      break;
    case 'stop':
      stopServer().then(() => process.exit(0));
      break;
    case 'status':
      showStatus().then(() => process.exit(0));
      break;
    case 'logs':
      viewLogs();
      break;
    case 'docs':
      showApiDocs().then(() => process.exit(0));
      break;
    case 'config':
      configureSettings().then(() => process.exit(0));
      break;
    case 'test':
      testApi().then(() => process.exit(0));
      break;
    default:
      console.log(chalk.red('Unknown command: ') + command);
      console.log(
        chalk.gray(
          'Available commands: start, stop, status, logs, docs, config, test',
        ),
      );
      console.log(
        chalk.gray('Or run without arguments to open interactive menu'),
      );
      process.exit(1);
  }
}
