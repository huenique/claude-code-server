const BaseStore = require('./baseStore');

/**
 * Task store
 */
class TaskStore extends BaseStore {
  constructor(dataDir = './data/tasks') {
    super(dataDir, 'tasks.json');
  }

  /**
   * Get default data structure
   */
  getDefaultData() {
    return { tasks: [] };
  }

  /**
   * Create task
   */
  async create(taskData) {
    return this.withLock(async () => {
      const task = {
        id: this.generateId(),
        created_at: this.now(),
        updated_at: this.now(),
        status: 'pending',
        prompt: taskData.prompt,
        project_path: taskData.project_path,
        model: taskData.model || 'claude-sonnet-4-5',
        priority: taskData.priority || 5,
        result: null,
        error: null,
        started_at: null,
        completed_at: null,
        duration_ms: null,
        cost_usd: 0,
        session_id: null,
        metadata: taskData.metadata || {},
      };

      this.db.data.tasks.push(task);
      return task;
    });
  }

  /**
   * Get task
   */
  async get(taskId) {
    await this.db.read();
    return this.db.data.tasks.find((t) => t.id === taskId);
  }

  /**
   * Update task
   */
  async update(taskId, updates) {
    return this.withLock(async () => {
      const index = this.db.data.tasks.findIndex((t) => t.id === taskId);
      if (index === -1) {
        return null;
      }

      // Merge updates
      this.db.data.tasks[index] = {
        ...this.db.data.tasks[index],
        ...updates,
        updated_at: this.now(),
      };

      return this.db.data.tasks[index];
    });
  }

  /**
   * Delete task
   */
  async delete(taskId) {
    return this.withLock(async () => {
      const index = this.db.data.tasks.findIndex((t) => t.id === taskId);
      if (index === -1) {
        return false;
      }

      this.db.data.tasks.splice(index, 1);
      return true;
    });
  }

  /**
   * List tasks
   */
  async list(options = {}) {
    await this.db.read();

    let tasks = this.db.data.tasks;

    // Filter conditions
    if (options.status) {
      tasks = tasks.filter((t) => t.status === options.status);
    }

    // Sorting (by priority and creation time)
    tasks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority comes first
      }
      return new Date(a.created_at) - new Date(b.created_at);
    });

    // Pagination
    if (options.limit) {
      tasks = tasks.slice(0, options.limit);
    }

    return tasks;
  }

  /**
   * Get next pending task
   */
  async getNextPending() {
    await this.db.read();

    const pendingTasks = this.db.data.tasks
      .filter((t) => t.status === 'pending')
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return new Date(a.created_at) - new Date(b.created_at);
      });

    return pendingTasks[0] || null;
  }

  /**
   * Mark task as processing
   */
  async markProcessing(taskId) {
    return this.update(taskId, {
      status: 'processing',
      started_at: this.now(),
    });
  }

  /**
   * Mark task as completed
   */
  async markCompleted(taskId, result, costUsd = 0) {
    const task = await this.get(taskId);
    if (!task) {
      return null;
    }

    const duration = task.started_at
      ? Date.now() - new Date(task.started_at).getTime()
      : null;

    return this.update(taskId, {
      status: 'completed',
      completed_at: this.now(),
      result,
      cost_usd: costUsd,
      duration_ms: duration,
    });
  }

  /**
   * Mark task as failed
   */
  async markFailed(taskId, error) {
    const task = await this.get(taskId);
    if (!task) {
      return null;
    }

    const duration = task.started_at
      ? Date.now() - new Date(task.started_at).getTime()
      : null;

    return this.update(taskId, {
      status: 'failed',
      completed_at: this.now(),
      error,
      duration_ms: duration,
    });
  }

  /**
   * Cancel task
   */
  async cancel(taskId) {
    const task = await this.get(taskId);
    if (!task) {
      return null;
    }

    // Only tasks in pending or processing state can be canceled
    if (task.status !== 'pending' && task.status !== 'processing') {
      return null;
    }

    return this.update(taskId, {
      status: 'cancelled',
      completed_at: this.now(),
    });
  }

  /**
   * Clean up old completed tasks
   */
  async cleanup(retentionDays) {
    return this.withLock(async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const beforeCount = this.db.data.tasks.length;
      this.db.data.tasks = this.db.data.tasks.filter(
        (t) =>
          new Date(t.completed_at || t.created_at) > cutoffDate ||
          (t.status !== 'completed' &&
            t.status !== 'failed' &&
            t.status !== 'cancelled'),
      );
      const deletedCount = beforeCount - this.db.data.tasks.length;

      return { deletedCount };
    });
  }

  /**
   * Get statistics
   */
  async getStats() {
    await this.db.read();

    const tasks = this.db.data.tasks;
    const stats = {
      total: tasks.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total_cost_usd: 0,
    };

    tasks.forEach((t) => {
      stats[t.status]++;
      stats.total_cost_usd += t.cost_usd || 0;
    });

    return stats;
  }
}

module.exports = TaskStore;
