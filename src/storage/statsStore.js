const BaseStore = require('./baseStore');

/**
 * Statistics store
 */
class StatsStore extends BaseStore {
  constructor(dataDir = './data/statistics') {
    super(dataDir, 'statistics.json');
  }

  /**
   * Get default data structure
   */
  getDefaultData() {
    return {
      daily: [],
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
      },
      tokens: {
        total_input: 0,
        total_output: 0,
      },
      costs: {
        total_usd: 0,
      },
      models: {},
    };
  }

  /**
   * Record request
   */
  async recordRequest(data) {
    return this.withLock(async () => {
      const today = this.getToday();

      // Update overall statistics
      this.db.data.requests.total++;
      if (data.success) {
        this.db.data.requests.successful++;
      } else {
        this.db.data.requests.failed++;
      }

      // Update token statistics
      if (data.input_tokens) {
        this.db.data.tokens.total_input += data.input_tokens;
      }
      if (data.output_tokens) {
        this.db.data.tokens.total_output += data.output_tokens;
      }

      // Update cost statistics
      if (data.cost_usd) {
        this.db.data.costs.total_usd += data.cost_usd;
      }

      // Update model statistics
      if (data.model) {
        if (!this.db.data.models[data.model]) {
          this.db.data.models[data.model] = {
            count: 0,
            cost_usd: 0,
          };
        }
        this.db.data.models[data.model].count++;
        this.db.data.models[data.model].cost_usd += data.cost_usd || 0;
      }

      // Update daily statistics
      let dailyEntry = this.db.data.daily.find((d) => d.date === today);
      if (!dailyEntry) {
        dailyEntry = {
          date: today,
          total_requests: 0,
          successful_requests: 0,
          failed_requests: 0,
          total_cost_usd: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          avg_duration_ms: 0,
          models: {},
        };
        this.db.data.daily.push(dailyEntry);
      }

      dailyEntry.total_requests++;
      if (data.success) {
        dailyEntry.successful_requests++;
      } else {
        dailyEntry.failed_requests++;
      }
      dailyEntry.total_cost_usd += data.cost_usd || 0;
      dailyEntry.total_input_tokens += data.input_tokens || 0;
      dailyEntry.total_output_tokens += data.output_tokens || 0;

      // Update daily model statistics
      if (data.model) {
        if (!dailyEntry.models[data.model]) {
          dailyEntry.models[data.model] = 0;
        }
        dailyEntry.models[data.model]++;
      }

      // Keep data for the most recent 90 days
      this.cleanupOldDailyEntries(90);

      return dailyEntry;
    });
  }

  /**
   * Get summary statistics
   */
  async getSummary() {
    await this.db.read();

    return {
      requests: { ...this.db.data.requests },
      tokens: { ...this.db.data.tokens },
      costs: { ...this.db.data.costs },
      models: { ...this.db.data.models },
    };
  }

  /**
   * Get daily statistics
   */
  async getDaily(options = {}) {
    await this.db.read();

    let daily = this.db.data.daily;

    // Sort by date descending
    daily = daily.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Limit number of returned items
    if (options.limit) {
      daily = daily.slice(0, options.limit);
    }

    return daily;
  }

  /**
   * Get statistics for a specific date
   */
  async getByDate(date) {
    await this.db.read();

    return this.db.data.daily.find((d) => d.date === date);
  }

  /**
   * Get date-range statistics
   */
  async getByDateRange(startDate, endDate) {
    await this.db.read();

    return this.db.data.daily.filter((d) => {
      const date = new Date(d.date);
      return date >= new Date(startDate) && date <= new Date(endDate);
    });
  }

  /**
   * Get today's date (YYYY-MM-DD)
   */
  getToday() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Clean up old daily statistics
   */
  cleanupOldDailyEntries(retentionDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    this.db.data.daily = this.db.data.daily.filter(
      (d) => new Date(d.date) >= cutoffDate,
    );
  }

  /**
   * Reset statistics
   */
  async reset() {
    return this.withLock(async () => {
      this.db.data = this.getDefaultData();
    });
  }

  /**
   * Get top models
   */
  async getTopModels(limit = 10) {
    await this.db.read();

    const models = Object.entries(this.db.data.models)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return models;
  }
}

module.exports = StatsStore;
