const StatsStore = require('../storage/statsStore');
const cron = require('node-cron');
const getLogger = require('../utils/logger');

/**
 * Statistics collector service
 */
class StatisticsCollector {
  constructor(config, statsStore) {
    this.config = config;
    this.statsStore = statsStore;
    this.logger = getLogger({
      logFile: config.logFile,
      logLevel: config.logLevel,
    });
    this.collectionTask = null;
  }

  /**
   * Start statistics collection
   */
  start() {
    if (!this.config.statistics?.enabled) {
      this.logger.info('Statistics collection is disabled');
      return;
    }

    // Collect statistics once per minute
    const interval = this.config.statistics.collectionInterval || 60000;
    const cronExpression = this.intervalToCron(interval);

    this.collectionTask = cron.schedule(cronExpression, async () => {
      await this.collectStatistics();
    });

    this.logger.info('Statistics collector started', { interval });
  }

  /**
   * Stop statistics collection
   */
  stop() {
    if (this.collectionTask) {
      this.collectionTask.stop();
      this.collectionTask = null;
      this.logger.info('Statistics collector stopped');
    }
  }

  /**
   * Collect statistics
   */
  async collectStatistics() {
    try {
      // System-level statistics can be collected here
      // For example: memory usage, CPU usage, etc.

      const stats = {
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      };

      this.logger.debug('Statistics collected', stats);
    } catch (error) {
      this.logger.error('Failed to collect statistics', {
        error: error.message,
      });
    }
  }

  /**
   * Get summary statistics
   */
  async getSummary() {
    return await this.statsStore.getSummary();
  }

  /**
   * Get daily statistics
   */
  async getDaily(options = {}) {
    return await this.statsStore.getDaily(options);
  }

  /**
   * Get date-range statistics
   */
  async getByDateRange(startDate, endDate) {
    return await this.statsStore.getByDateRange(startDate, endDate);
  }

  /**
   * Get top models
   */
  async getTopModels(limit = 10) {
    return await this.statsStore.getTopModels(limit);
  }

  /**
   * Reset statistics
   */
  async reset() {
    return await this.statsStore.reset();
  }

  /**
   * Convert interval to cron expression
   */
  intervalToCron(intervalMs) {
    // Simple implementation: run once per minute
    // More complex implementations can generate cron expressions dynamically by interval
    return '* * * * *';
  }
}

module.exports = StatisticsCollector;
