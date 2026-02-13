const SessionStore = require('../storage/sessionStore');
const ClaudeExecutor = require('./claudeExecutor');
const getLogger = require('../utils/logger');

/**
 * Session management service
 */
class SessionManager {
  constructor(config, sessionStore, claudeExecutor) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.claudeExecutor = claudeExecutor;
    this.logger = getLogger({
      logFile: config.logFile,
      logLevel: config.logLevel,
    });
  }

  /**
   * Create a new session
   */
  async createSession(sessionData) {
    const session = await this.sessionStore.create(sessionData);
    this.logger.info(`Session created`, {
      session_id: session.id,
      project_path: session.project_path,
    });
    return session;
  }

  /**
   * Get session details
   */
  async getSession(sessionId) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return null;
    }
    return session;
  }

  /**
   * Continue a session conversation
   */
  async continueSession(sessionId, options) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    // Check session status
    if (session.status !== 'active') {
      return {
        success: false,
        error: `Session is not active: ${session.status}`,
      };
    }

    // Execute Claude using session configuration
    const result = await this.claudeExecutor.execute({
      prompt: options.prompt,
      projectPath: session.project_path,
      model: options.model || session.model,
      sessionId: session.id,
      systemPrompt: options.systemPrompt,
      maxBudgetUsd: options.maxBudgetUsd,
      stream: options.stream,
    });

    return result;
  }

  /**
   * List sessions
   */
  async listSessions(options = {}) {
    const sessions = await this.sessionStore.list(options);
    return sessions;
  }

  /**
   * Search sessions
   */
  async searchSessions(query, options = {}) {
    const sessions = await this.sessionStore.search(query, options);
    return sessions;
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    const deleted = await this.sessionStore.delete(sessionId);
    if (deleted) {
      this.logger.info(`Session deleted`, { session_id: sessionId });
      return { success: true };
    }
    return { success: false, error: 'Session not found' };
  }

  /**
   * Update session status
   */
  async updateSessionStatus(sessionId, status) {
    const session = await this.sessionStore.update(sessionId, { status });
    if (session) {
      this.logger.info(`Session status updated`, {
        session_id: sessionId,
        status,
      });
      return { success: true, session };
    }
    return { success: false, error: 'Session not found' };
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      messages_count: session.messages_count,
      total_cost_usd: session.total_cost_usd,
      model: session.model,
      project_path: session.project_path,
      status: session.status,
    };
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions() {
    const retentionDays = this.config.sessionRetentionDays || 30;
    const result = await this.sessionStore.cleanup(retentionDays);
    this.logger.info(`Expired sessions cleaned up`, {
      deleted_count: result.deletedCount,
    });
    return result;
  }
}

module.exports = SessionManager;
