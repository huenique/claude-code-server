const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chalk = require('chalk');

// 配置目录和文件
const configDir = path.join(process.env.HOME || os.homedir(), '.claude-code-server');
const configPath = path.join(configDir, 'config.json');

// 默认配置（用于未找到路径时的回退）
// 注意：这些路径会在 loadConfig() 中动态修正
const defaultConfig = {
  port: 5546,
  host: '0.0.0.0',
  claudePath: path.join(process.env.HOME || os.homedir(), '.nvm', 'versions', 'node', 'v22.21.0', 'bin', 'claude'),
  nvmBin: path.join(process.env.HOME || os.homedir(), '.nvm', 'versions', 'node', 'v22.21.0', 'bin'),
  defaultProjectPath: path.join(process.env.HOME || os.homedir(), 'workspace'),
  logFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs', 'server.log'),
  pidFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'server.pid'),
  dataDir: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
  sessionRetentionDays: 30,
};

// 加载配置（支持异步路径检测）
async function loadConfig() {
  // 确保所有必要目录都存在
  const dirsToCreate = [
    configDir,
    path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs'),
    path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
  ];

  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ 创建目录: ${dir}`);
      } catch (err) {
        console.error(`❌ 创建目录失败 ${dir}:`, err.message);
        // 尝试继续，不中断流程
      }
    }
  }

  let config;
  if (!fs.existsSync(configPath)) {
    // 首次启动，使用默认配置
    config = { ...defaultConfig };
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ 创建配置文件: ${configPath}`);
    } catch (err) {
      console.error(`❌ 创建配置文件失败 ${configPath}:`, err.message);
      throw err;
    }
  } else {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  // 检测是否为 root 用户
  const isRunningAsRoot = process.getuid() === 0; // UID 0 = root

  if (isRunningAsRoot && config.enableRootCompatibility === false) {
    // 如果是 root 用户且未启用 root 兼容模式，显示错误并退出
    console.error('');
    console.error(chalk.red.bold('═════════════════════════════════════════'));
    console.error(chalk.red.bold('⚠️  检测到以 root 用户运行，但 root 兼容模式未启用'));
    console.error('');
    console.error(chalk.yellow('Claude CLI 不允许在 root 权限下使用 --allow-dangerously-skip-permissions'));
    console.error('');
    console.error(chalk.cyan('解决方案：'));
    console.error(chalk.white('  1. 在配置菜单中启用"root 兼容模式"'));
    console.error(chalk.white('  2. 或者使用普通用户运行服务'));
    console.error('');
    console.error(chalk.gray('提示：使用 "node cli.js" 进入配置菜单'));
    console.error(chalk.red.bold('═════════════════════════════════════════'));
    console.error('');
    process.exit(1);
  } else if (isRunningAsRoot && config.enableRootCompatibility !== false) {
    // root 用户且已启用 root 兼容模式，显示提示信息但继续运行
    console.error('');
    console.error(chalk.yellow.bold('═════════════════════════════════════════'));
    console.error(chalk.yellow.bold('ℹ️  Root 兼容模式已启用'));
    console.error('');
    console.error(chalk.cyan('正在使用 IS_SANDBOX=1 环境变量绕过 Claude CLI 的 root 限制'));
    console.error('');
    console.error(chalk.yellow('⚠️  请确保您了解在 root 下运行 AI 助手的风险！'));
    console.error(chalk.yellow.bold('═════════════════════════════════════════'));
    console.error('');
  }

  // 自动检测和修复路径
  const PathResolver = require('./src/utils/pathResolver');
  const resolver = new PathResolver();
  const results = await resolver.detectAndValidate(config);
  const { updates, warnings } = resolver.applyDetectionResults(config, results);

  // 如果路径有更新，保存配置
  if (updates.length > 0) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ 配置已更新: ${configPath}`);
    } catch (err) {
      console.error(`❌ 更新配置失败 ${configPath}:`, err.message);
    }
  }

  // 保存诊断信息用于日志输出
  config._pathDetection = { updates, warnings };

  return config;
}

// 主初始化函数
async function main() {
  // 加载配置（包含路径自动检测）
  const config = await loadConfig();

  // 确保日志目录存在
  if (config.logFile) {
    const logDir = path.dirname(config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // 获取 logger
  const getLogger = require('./src/utils/logger');
  const logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });

  // 输出路径检测结果
  if (config._pathDetection.updates.length > 0) {
    logger.info('Auto-detected paths:', { updates: config._pathDetection.updates });
  }
  if (config._pathDetection.warnings.length > 0) {
    logger.warn('Path detection warnings:', { warnings: config._pathDetection.warnings });
  }

  // 删除内部诊断信息
  delete config._pathDetection;

  // 重置所有服务模块的缓存（确保后台模式使用正确的配置）
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

  modulePaths.forEach(modPath => {
    delete require.cache[require.resolve(modPath)];
  });

  // 初始化存储
  const SessionStore = require('./src/storage/sessionStore');
  const TaskStore = require('./src/storage/taskStore');
  const StatsStore = require('./src/storage/statsStore');

  const sessionStore = new SessionStore(config.dataDir + '/sessions');
  const taskStore = new TaskStore(config.dataDir + '/tasks');
  const statsStore = new StatsStore(config.dataDir + '/statistics');

  // 初始化服务
  const ClaudeExecutor = require('./src/services/claudeExecutor');
  const SessionManager = require('./src/services/sessionManager');
  const RateLimiter = require('./src/services/rateLimiter');
  const StatisticsCollector = require('./src/services/statisticsCollector');
  const TaskQueue = require('./src/services/taskQueue');
  const WebhookNotifier = require('./src/services/webhookNotifier');

  const claudeExecutor = new ClaudeExecutor(config, sessionStore, statsStore);
  const sessionManager = new SessionManager(config, sessionStore, claudeExecutor);
  const rateLimiter = new RateLimiter(config);
  const statisticsCollector = new StatisticsCollector(config, statsStore);
  const webhookNotifier = new WebhookNotifier(config);
  const taskQueue = new TaskQueue(config, taskStore, claudeExecutor, webhookNotifier);

  // 加载路由
  const createHealthRoute = require('./src/routes/health');
  const createConfigRoute = require('./src/routes/config');
  const createClaudeRoutes = require('./src/routes/claude');
  const createSessionRoutes = require('./src/routes/sessions');
  const createStatisticsRoutes = require('./src/routes/statistics');
  const createTaskRoutes = require('./src/routes/tasks');

  // 创建 Express 应用
  const app = express();
  const PORT = process.env.PORT || config.port;
  const HOST = process.env.HOST || config.host;

  // 中间件
  app.use(express.json());

  // 应用速率限制
  app.use('/api/', rateLimiter.getMiddleware());

  // 挂载路由
  app.get('/health', createHealthRoute());
  app.get('/api/config', createConfigRoute(configPath));
  app.use('/api/claude', createClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager));
  app.use('/api/sessions', createSessionRoutes(sessionManager));
  app.use('/api/statistics', createStatisticsRoutes(statisticsCollector));
  app.use('/api/tasks', createTaskRoutes(taskQueue));

  // 配置热重载
  let configWatcher = null;
  let reloadCount = 0;

  // 热重载配置
  async function hotReloadConfig() {
    try {
      reloadCount++;

      // 重新加载配置
      const newConfig = await loadConfig();

      // 检查关键配置变化
      const configChanges = [];
      if (newConfig.taskQueue?.concurrency !== config.taskQueue?.concurrency) {
        configChanges.push(`taskQueue.concurrency: ${config.taskQueue?.concurrency} → ${newConfig.taskQueue?.concurrency}`);
        // 更新 TaskQueue 并发数
        taskQueue.concurrency = newConfig.taskQueue?.concurrency || 3;
        taskQueue.defaultTimeout = newConfig.taskQueue?.defaultTimeout || 300000;
      }
      if (newConfig.rateLimit?.enabled !== config.rateLimit?.enabled) {
        configChanges.push(`rateLimit.enabled: ${config.rateLimit?.enabled} → ${newConfig.rateLimit?.enabled}`);
      }
      if (newConfig.webhook?.enabled !== config.webhook?.enabled) {
        configChanges.push(`webhook.enabled: ${config.webhook?.enabled} → ${newConfig.webhook?.enabled}`);
        // 更新 WebhookNotifier
        webhookNotifier.config = newConfig;
      }
      if (newConfig.logLevel !== config.logLevel) {
        configChanges.push(`logLevel: ${config.logLevel} → ${newConfig.logLevel}`);
      }

      // 更新配置对象（保留引用）
      Object.assign(config, newConfig);

      if (configChanges.length > 0) {
        logger.info(`[Config Reload #${reloadCount}] 配置已更新:`, { changes: configChanges });
      } else {
        logger.info(`[Config Reload #${reloadCount}] 配置文件已重新加载（无变化）`);
      }

      logger.info(`[Config Reload #${reloadCount}] 当前任务队列并发数: ${taskQueue.concurrency}`);
    } catch (error) {
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: 'error' });
      logger.error(`[Config Reload #${reloadCount}] 配置重载失败:`, { error: error.message });
    }
  }

  // 启动配置文件监听
  function startConfigWatcher() {
    if (configWatcher) {
      return; // 已经在监听
    }

    try {
      // 使用防抖，避免多次触发
      let reloadTimer = null;
      const DEBOUNCE_DELAY = 500; // 500ms 防抖

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
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
      logger.info(`配置文件监听已启动: ${configPath}`);
      logger.info('配置文件修改将自动生效（热重载）');
    } catch (error) {
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: 'error' });
      logger.error('启动配置文件监听失败:', { error: error.message });
    }
  }

// 启动服务器
  const server = app.listen(PORT, HOST, async () => {
    // 初始化存储
    await sessionStore.init();
    await taskStore.init();
    await statsStore.init();

    const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
    logger.info(`Claude Code Server started on http://${HOST}:${PORT}`);
    logger.info(`Claude path: ${config.claudePath}`);
    logger.info(`NVM bin: ${config.nvmBin}`);
    logger.info(`Default project: ${config.defaultProjectPath}`);

    // 启动统计收集器
    statisticsCollector.start();

    // 启动任务队列
    await taskQueue.start();

    // 启动配置文件监听
    startConfigWatcher();

    // 写入 PID 文件
    if (config.pidFile) {
      const pidDir = path.dirname(config.pidFile);
      if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
      }
      fs.writeFileSync(config.pidFile, process.pid.toString());
    }
  });

  // 优雅关闭
  async function shutdown(signal) {
    const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
    logger.info(`${signal} received, shutting down gracefully...`);

    // 停止配置文件监听
    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
      logger.info('配置文件监听已停止');
    }

    // 停止统计收集器
    statisticsCollector.stop();

    // 停止任务队列
    await taskQueue.stop();

    server.close(() => {
      logger.info('Server closed');

      // 删除 PID 文件
      if (fs.existsSync(config.pidFile)) {
        fs.unlinkSync(config.pidFile);
      }
      process.exit(0);
    });

    // 强制退出超时
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = main;

// 如果直接运行此文件，捕获错误
if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
