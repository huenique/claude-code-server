const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chalk = require('chalk');

// Configuration directory and file
const configDir = path.join(
  process.env.HOME || os.homedir(),
  '.claude-code-server',
);
const configPath = path.join(configDir, 'config.json');

// Default config (fallback when paths are not found)
// Note: These paths are dynamically corrected in loadConfig()
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
};

// Load config (supports async path detection)
async function loadConfig() {
  // Ensure all required directories exist
  const dirsToCreate = [
    configDir,
    path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs'),
    path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
  ];

  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      } catch (err) {
        console.error(`❌ Failed to create directory ${dir}:`, err.message);
        // Try to continue without interrupting the flow
      }
    }
  }

  let config;
  if (!fs.existsSync(configPath)) {
    // First startup: use default config
    config = { ...defaultConfig };
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ Created config file: ${configPath}`);
    } catch (err) {
      console.error(
        `❌ Failed to create config file ${configPath}:`,
        err.message,
      );
      throw err;
    }
  } else {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  // Detect whether running as root user
  const isRunningAsRoot =
    typeof process.getuid === 'function' && process.getuid() === 0; // UID 0 = root

  if (isRunningAsRoot && config.enableRootCompatibility === false) {
    // If running as root and root compatibility is disabled, show error and exit
    console.error('');
    console.error(chalk.red.bold('═════════════════════════════════════════'));
    console.error(
      chalk.red.bold(
        '⚠️  Detected root user mode, but root compatibility is disabled',
      ),
    );
    console.error('');
    console.error(
      chalk.yellow(
        'Claude CLI does not allow --allow-dangerously-skip-permissions when running as root',
      ),
    );
    console.error('');
    console.error(chalk.cyan('Solutions:'));
    console.error(
      chalk.white('  1. Enable "Root Compatibility Mode" in the config menu'),
    );
    console.error(chalk.white('  2. Or run the service as a non-root user'));
    console.error('');
    console.error(chalk.gray('Tip: run "node cli.js" to open the config menu'));
    console.error(chalk.red.bold('═════════════════════════════════════════'));
    console.error('');
    process.exit(1);
  } else if (isRunningAsRoot && config.enableRootCompatibility !== false) {
    // Running as root with root compatibility enabled: show notice and continue
    console.error('');
    console.error(
      chalk.yellow.bold('═════════════════════════════════════════'),
    );
    console.error(chalk.yellow.bold('ℹ️  Root Compatibility Mode is enabled'));
    console.error('');
    console.error(
      chalk.cyan('Using IS_SANDBOX=1 to bypass Claude CLI root restrictions'),
    );
    console.error('');
    console.error(
      chalk.yellow(
        '⚠️  Please make sure you understand the risks of running an AI assistant as root!',
      ),
    );
    console.error(
      chalk.yellow.bold('═════════════════════════════════════════'),
    );
    console.error('');
  }

  // Auto-detect and fix paths
  const PathResolver = require('./src/utils/pathResolver');
  const resolver = new PathResolver();
  const results = await resolver.detectAndValidate(config);
  const { updates, warnings } = resolver.applyDetectionResults(config, results);

  // If paths were updated, save config
  if (updates.length > 0) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ Config updated: ${configPath}`);
    } catch (err) {
      console.error(`❌ Failed to update config ${configPath}:`, err.message);
    }
  }

  // Save diagnostics for log output
  config._pathDetection = { updates, warnings };

  return config;
}

// Main initialization function
async function main() {
  // Load config (including automatic path detection)
  const config = await loadConfig();

  // Ensure log directory exists
  if (config.logFile) {
    const logDir = path.dirname(config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // Get logger
  const getLogger = require('./src/utils/logger');
  const logger = getLogger({
    logFile: config.logFile,
    logLevel: config.logLevel,
  });

  // Output path detection results
  if (config._pathDetection.updates.length > 0) {
    logger.info('Auto-detected paths:', {
      updates: config._pathDetection.updates,
    });
  }
  if (config._pathDetection.warnings.length > 0) {
    logger.warn('Path detection warnings:', {
      warnings: config._pathDetection.warnings,
    });
  }

  // Remove internal diagnostics
  delete config._pathDetection;

  // Reset cache for all service modules (ensure background mode uses correct config)
  const modulePaths = [
    './src/utils/logger',
    './src/services/claudeExecutor',
    './src/services/sessionManager',
    './src/services/rateLimiter',
    './src/services/statisticsCollector',
    './src/services/taskQueue',
    './src/services/webhookNotifier',
    './src/storage/sessionStore',
    './src/storage/taskStore',
    './src/storage/statsStore',
  ];

  modulePaths.forEach((modPath) => {
    delete require.cache[require.resolve(modPath)];
  });

  // Initialize storage
  const SessionStore = require('./src/storage/sessionStore');
  const TaskStore = require('./src/storage/taskStore');
  const StatsStore = require('./src/storage/statsStore');

  const sessionStore = new SessionStore(config.dataDir + '/sessions');
  const taskStore = new TaskStore(config.dataDir + '/tasks');
  const statsStore = new StatsStore(config.dataDir + '/statistics');

  // Initialize services
  const ClaudeExecutor = require('./src/services/claudeExecutor');
  const SessionManager = require('./src/services/sessionManager');
  const RateLimiter = require('./src/services/rateLimiter');
  const StatisticsCollector = require('./src/services/statisticsCollector');
  const TaskQueue = require('./src/services/taskQueue');
  const WebhookNotifier = require('./src/services/webhookNotifier');

  const claudeExecutor = new ClaudeExecutor(config, sessionStore, statsStore);
  const sessionManager = new SessionManager(
    config,
    sessionStore,
    claudeExecutor,
  );
  const rateLimiter = new RateLimiter(config);
  const statisticsCollector = new StatisticsCollector(config, statsStore);
  const webhookNotifier = new WebhookNotifier(config);
  const taskQueue = new TaskQueue(
    config,
    taskStore,
    claudeExecutor,
    webhookNotifier,
  );

  // Load routes
  const createHealthRoute = require('./src/routes/health');
  const createConfigRoute = require('./src/routes/config');
  const createClaudeRoutes = require('./src/routes/claude');
  const createSessionRoutes = require('./src/routes/sessions');
  const createStatisticsRoutes = require('./src/routes/statistics');
  const createTaskRoutes = require('./src/routes/tasks');

  // Create Express app
  const app = express();
  const PORT = process.env.PORT || config.port;
  const HOST = process.env.HOST || config.host;

  // Middleware
  app.use(express.json());

  // Apply rate limiting
  app.use('/api/', rateLimiter.getMiddleware());

  // Mount routes
  app.get('/health', createHealthRoute());
  app.get('/api/config', createConfigRoute(configPath));
  app.use(
    '/api/claude',
    createClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager),
  );
  app.use('/api/sessions', createSessionRoutes(sessionManager));
  app.use('/api/statistics', createStatisticsRoutes(statisticsCollector));
  app.use('/api/tasks', createTaskRoutes(taskQueue));

  // Configure hot reload
  let configWatcher = null;
  let reloadCount = 0;

  // Hot-reload config
  async function hotReloadConfig() {
    try {
      reloadCount++;

      // Reload config
      const newConfig = await loadConfig();

      // Check critical config changes
      const configChanges = [];
      if (newConfig.taskQueue?.concurrency !== config.taskQueue?.concurrency) {
        configChanges.push(
          `taskQueue.concurrency: ${config.taskQueue?.concurrency} → ${newConfig.taskQueue?.concurrency}`,
        );
        // Update TaskQueue concurrency
        taskQueue.concurrency = newConfig.taskQueue?.concurrency || 3;
        taskQueue.defaultTimeout =
          newConfig.taskQueue?.defaultTimeout || 300000;
      }
      if (newConfig.rateLimit?.enabled !== config.rateLimit?.enabled) {
        configChanges.push(
          `rateLimit.enabled: ${config.rateLimit?.enabled} → ${newConfig.rateLimit?.enabled}`,
        );
      }
      if (newConfig.webhook?.enabled !== config.webhook?.enabled) {
        configChanges.push(
          `webhook.enabled: ${config.webhook?.enabled} → ${newConfig.webhook?.enabled}`,
        );
        // Update WebhookNotifier
        webhookNotifier.config = newConfig;
      }
      if (newConfig.logLevel !== config.logLevel) {
        configChanges.push(
          `logLevel: ${config.logLevel} → ${newConfig.logLevel}`,
        );
      }

      // Update config object (preserve reference)
      Object.assign(config, newConfig);

      if (configChanges.length > 0) {
        logger.info(`[Config Reload #${reloadCount}] Config updated:`, {
          changes: configChanges,
        });
      } else {
        logger.info(
          `[Config Reload #${reloadCount}] Config file reloaded (no changes)`,
        );
      }

      logger.info(
        `[Config Reload #${reloadCount}] Current task queue concurrency: ${taskQueue.concurrency}`,
      );
    } catch (error) {
      const logger = require('./src/utils/logger')({
        logFile: config.logFile,
        logLevel: 'error',
      });
      logger.error(`[Config Reload #${reloadCount}] Config reload failed:`, {
        error: error.message,
      });
    }
  }

  // Start config file watcher
  function startConfigWatcher() {
    if (configWatcher) {
      return; // Already watching
    }

    try {
      // Debounce to avoid multiple triggers
      let reloadTimer = null;
      const DEBOUNCE_DELAY = 500; // 500ms debounce

      configWatcher = fs.watch(configPath, (eventType, filename) => {
        if (eventType === 'change') {
          if (reloadTimer) {
            clearTimeout(reloadTimer);
          }
          reloadTimer = setTimeout(() => {
            hotReloadConfig();
            reloadTimer = null;
          }, DEBOUNCE_DELAY);
        }
      });
      const logger = require('./src/utils/logger')({
        logFile: config.logFile,
        logLevel: config.logLevel,
      });
      logger.info(`Config file watcher started: ${configPath}`);
      logger.info('Config changes will be applied automatically (hot reload)');
    } catch (error) {
      const logger = require('./src/utils/logger')({
        logFile: config.logFile,
        logLevel: 'error',
      });
      logger.error('Failed to start config file watcher:', {
        error: error.message,
      });
    }
  }

  // Start server
  const server = app.listen(PORT, HOST, async () => {
    // Initialize storage
    await sessionStore.init();
    await taskStore.init();
    await statsStore.init();

    const logger = require('./src/utils/logger')({
      logFile: config.logFile,
      logLevel: config.logLevel,
    });
    logger.info(`Claude Code Server started on http://${HOST}:${PORT}`);
    logger.info(`Claude path: ${config.claudePath}`);
    logger.info(`NVM bin: ${config.nvmBin}`);
    logger.info(`Default project: ${config.defaultProjectPath}`);

    // Start statistics collector
    statisticsCollector.start();

    // Start task queue
    await taskQueue.start();

    // Start config file watcher
    startConfigWatcher();

    // Write PID file
    if (config.pidFile) {
      const pidDir = path.dirname(config.pidFile);
      if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
      }
      fs.writeFileSync(config.pidFile, process.pid.toString());
    }
  });

  // Graceful shutdown
  async function shutdown(signal) {
    const logger = require('./src/utils/logger')({
      logFile: config.logFile,
      logLevel: config.logLevel,
    });
    logger.info(`${signal} received, shutting down gracefully...`);

    // Stop config file watcher
    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
      logger.info('Config file watcher stopped');
    }

    // Stop statistics collector
    statisticsCollector.stop();

    // Stop task queue
    await taskQueue.stop();

    server.close(() => {
      logger.info('Server closed');

      // Remove PID file
      if (fs.existsSync(config.pidFile)) {
        fs.unlinkSync(config.pidFile);
      }
      process.exit(0);
    });

    // Force-exit timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = main;

// If this file is run directly, catch errors
if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
