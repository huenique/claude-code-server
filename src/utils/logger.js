const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Logger utility
 */
class Logger {
  constructor(config = {}) {
    this.logFile =
      config.logFile ||
      path.join(
        process.env.HOME || require('os').homedir(),
        '.claude-code-server',
        'logs',
        'server.log',
      );
    this.logLevel = config.logLevel || 'info';
    this.logger = null;
  }

  /**
   * Initialize logger
   */
  init() {
    // If logger already exists, do not recreate it (avoid duplicate initialization)
    if (this.logger) {
      return;
    }

    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Use file transport only, no console output
    const transports = [
      new winston.transports.File({
        filename: this.logFile,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      }),
    ];

    // Create logger
    this.logger = winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      transports,
    });
  }

  info(message, meta = {}) {
    if (this.logger) {
      this.logger.info(message, meta);
    }
  }

  error(message, meta = {}) {
    if (this.logger) {
      this.logger.error(message, meta);
    }
  }

  warn(message, meta = {}) {
    if (this.logger) {
      this.logger.warn(message, meta);
    }
  }

  debug(message, meta = {}) {
    if (this.logger) {
      this.logger.debug(message, meta);
    }
  }
}

// Singleton - simplified implementation to avoid duplicate creation
let loggerInstance = null;

function getLogger(config) {
  // If instance does not exist, create a new one
  if (!loggerInstance) {
    loggerInstance = new Logger(config);
    loggerInstance.init();
  }

  return loggerInstance;
}

module.exports = getLogger;
