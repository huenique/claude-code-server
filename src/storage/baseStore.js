const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dynamically import LowDB ESM modules
async function loadLowDB() {
  const lowdb = await import('lowdb');
  return lowdb;
}

// Create CommonJS-compatible import helper
async function getLowDB() {
  const lowdb = await loadLowDB();
  return lowdb.Low;
}

async function getJSONFile() {
  const lowdb = await loadLowDB();
  return lowdb.JSONFile;
}

/**
 * Base store class with file locking
 */
class BaseStore {
  constructor(dataDir, dbFileName) {
    this.dataDir = dataDir;
    this.dbFileName = dbFileName;
    this.dbPath = path.join(dataDir, dbFileName);
    this.lockFilePath = this.dbPath + '.lock';
    this.db = null;
  }

  /**
   * Initialize database
   */
  async init() {
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Dynamically import ESM modules
    const LowDB = await getLowDB();
    const JSONFile = await getJSONFile();

    // Initialize LowDB
    const adapter = new JSONFile(this.dbPath);
    this.db = new LowDB(adapter, this.getDefaultData());

    // Read data
    await this.db.read();

    // If this is a new file, write default data
    if (!this.db.data) {
      this.db.data = this.getDefaultData();
      await this.db.write();
    }
  }

  /**
   * Get default data structure (must be implemented by subclass)
   */
  getDefaultData() {
    return {};
  }

  /**
   * Acquire file lock
   */
  async acquireLock(timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // Try creating lock file (O_EXCL ensures atomicity)
        const lockId = crypto.randomUUID();
        fs.writeFileSync(this.lockFilePath, lockId, { flag: 'wx' });
        return lockId;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Lock file exists, wait and retry
          await new Promise((resolve) => setTimeout(resolve, 50));
        } else {
          throw err;
        }
      }
    }

    throw new Error('Failed to acquire lock: timeout');
  }

  /**
   * Release file lock
   */
  releaseLock(lockId) {
    try {
      // Verify lock file ID matches
      const currentLockId = fs.readFileSync(this.lockFilePath, 'utf8');
      if (currentLockId === lockId) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Locked write operation
   */
  async withLock(operation) {
    const lockId = await this.acquireLock();
    try {
      const result = await operation();
      await this.db.write();
      return result;
    } finally {
      this.releaseLock(lockId);
    }
  }

  /**
   * Generate UUID
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Get current timestamp
   */
  now() {
    return new Date().toISOString();
  }
}

module.exports = BaseStore;
