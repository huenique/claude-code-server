const BaseStore = require('./baseStore');

/**
 * Session store
 */
class SessionStore extends BaseStore {
  constructor(dataDir = './data/sessions') {
    super(dataDir, 'sessions.json');
  }

  /**
   * Get default data structure
   */
  getDefaultData() {
    return { sessions: [] };
  }

  /**
   * Create session
   */
  async create(sessionData) {
    return this.withLock(async () => {
      const session = {
        id: this.generateId(),
        created_at: this.now(),
        updated_at: this.now(),
        model: sessionData.model || 'claude-sonnet-4-5',
        project_path: sessionData.project_path,
        total_cost_usd: 0,
        messages_count: 0,
        status: 'active',
        metadata: sessionData.metadata || {},
      };

      this.db.data.sessions.push(session);
      return session;
    });
  }

  /**
   * Get session
   */
  async get(sessionId) {
    await this.db.read();
    return this.db.data.sessions.find((s) => s.id === sessionId);
  }

  /**
   * Update session
   */
  async update(sessionId, updates) {
    return this.withLock(async () => {
      const index = this.db.data.sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) {
        return null;
      }

      // Merge updates
      this.db.data.sessions[index] = {
        ...this.db.data.sessions[index],
        ...updates,
        updated_at: this.now(),
      };

      return this.db.data.sessions[index];
    });
  }

  /**
   * Delete session
   */
  async delete(sessionId) {
    return this.withLock(async () => {
      const index = this.db.data.sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) {
        return false;
      }

      this.db.data.sessions.splice(index, 1);
      return true;
    });
  }

  /**
   * List all sessions
   */
  async list(options = {}) {
    await this.db.read();

    let sessions = this.db.data.sessions;

    // Filter conditions
    if (options.status) {
      sessions = sessions.filter((s) => s.status === options.status);
    }

    if (options.project_path) {
      sessions = sessions.filter(
        (s) => s.project_path === options.project_path,
      );
    }

    // Sorting
    sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    // Pagination
    if (options.limit) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions;
  }

  /**
   * Search sessions
   */
  async search(query, options = {}) {
    await this.db.read();

    const lowerQuery = query.toLowerCase();
    let sessions = this.db.data.sessions.filter(
      (s) =>
        s.id.toLowerCase().includes(lowerQuery) ||
        (s.metadata &&
          JSON.stringify(s.metadata).toLowerCase().includes(lowerQuery)),
    );

    // Sorting
    sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    // Pagination
    if (options.limit) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions;
  }

  /**
   * Clean up expired sessions
   */
  async cleanup(retentionDays) {
    return this.withLock(async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const beforeCount = this.db.data.sessions.length;
      this.db.data.sessions = this.db.data.sessions.filter(
        (s) => new Date(s.updated_at) > cutoffDate,
      );
      const deletedCount = beforeCount - this.db.data.sessions.length;

      return { deletedCount };
    });
  }

  /**
   * Increment message count
   */
  async incrementMessages(sessionId) {
    return this.withLock(async () => {
      const session = this.db.data.sessions.find((s) => s.id === sessionId);
      if (!session) {
        return null;
      }

      session.messages_count = (session.messages_count || 0) + 1;
      session.updated_at = this.now();

      return session;
    });
  }

  /**
   * Add cost
   */
  async addCost(sessionId, costUsd) {
    return this.withLock(async () => {
      const session = this.db.data.sessions.find((s) => s.id === sessionId);
      if (!session) {
        return null;
      }

      session.total_cost_usd = (session.total_cost_usd || 0) + costUsd;
      session.updated_at = this.now();

      return session;
    });
  }
}

module.exports = SessionStore;
