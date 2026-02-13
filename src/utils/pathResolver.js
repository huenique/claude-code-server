const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Path resolver - auto-detect Claude-related paths
 */
class PathResolver {
  constructor() {
    this.platform = process.platform;
    this.isWindows = this.platform === 'win32';
  }

  /**
   * Detect and validate all paths
   */
  async detectAndValidate(config) {
    const results = {
      claudePath: await this.detectClaudePath(config.claudePath),
      nvmBin: null, // Must be handled after claudePath detection
      defaultProjectPath: await this.detectProjectPath(
        config.defaultProjectPath,
      ),
    };

    // nvmBin depends on the resolved claudePath
    results.nvmBin = await this.detectNvmBin(config.nvmBin, results.claudePath);

    return results;
  }

  /**
   * Detect Claude CLI path
   */
  async detectClaudePath(existingPath) {
    const attempts = [];

    // 1. Check whether existing config is valid
    if (existingPath && (await this.isExecutable(existingPath))) {
      return { found: true, path: existingPath, method: 'existing_config' };
    }
    if (existingPath) {
      attempts.push({
        path: existingPath,
        reason: 'from_config',
        valid: false,
      });
    }

    // 2. Use which/where command
    const whichPath = await this.which('claude');
    if (whichPath && (await this.isExecutable(whichPath))) {
      return { found: true, path: whichPath, method: 'which_command' };
    }
    if (whichPath)
      attempts.push({ path: whichPath, reason: 'which_command', valid: false });

    // 3. Traverse NVM directories
    const nvmPath = await this.findInNvm('claude');
    if (nvmPath) {
      return { found: true, path: nvmPath, method: 'nvm_scan' };
    }

    // 4. Check common system paths
    const systemPaths = this.isWindows
      ? [
          path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(process.env.ProgramFiles || '', 'claude', 'claude.exe'),
          path.join(
            process.env['ProgramFiles(x86)'] || '',
            'claude',
            'claude.exe',
          ),
        ]
      : [
          '/usr/local/bin/claude',
          '/usr/bin/claude',
          path.join(os.homedir(), 'npm-global', 'bin', 'claude'),
          path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
        ];

    for (const sysPath of systemPaths) {
      if (await this.isExecutable(sysPath)) {
        return { found: true, path: sysPath, method: 'system_path' };
      }
      attempts.push({ path: sysPath, reason: 'system_path', valid: false });
    }

    // 5. Check PATH environment variable
    const pathEnvPath = await this.findInPathEnv('claude');
    if (pathEnvPath) {
      return { found: true, path: pathEnvPath, method: 'path_env' };
    }

    // Not found
    return {
      found: false,
      path: null,
      attempts,
      error: this.generateClaudePathError(attempts),
    };
  }

  /**
   * Detect NVM bin directory
   */
  async detectNvmBin(existingPath, claudePathResult) {
    const attempts = [];

    // 1. Check whether existing config is valid
    if (existingPath && fs.existsSync(existingPath)) {
      return { found: true, path: existingPath, method: 'existing_config' };
    }
    if (existingPath) {
      attempts.push({
        path: existingPath,
        reason: 'from_config',
        valid: false,
      });
    }

    // 2. Infer from claudePath
    if (claudePathResult.found && claudePathResult.path) {
      const inferred = this.inferNvmBinFromClaudePath(claudePathResult.path);
      if (inferred && fs.existsSync(inferred)) {
        return { found: true, path: inferred, method: 'inferred_from_claude' };
      }
      if (inferred) {
        attempts.push({
          path: inferred,
          reason: 'inferred_from_claude',
          valid: false,
        });
      }
    }

    // 3. Use NVM environment variable
    const nvmDirEnv = process.env.NVM_DIR;
    if (nvmDirEnv) {
      const currentVersion =
        process.env.NVM_CURRENT || process.env.NVM_NODEJS_ORG_MIRROR;
      // Try reading currently active version
      const nvmCurrentPath = path.join(nvmDirEnv, 'current', 'bin');
      if (fs.existsSync(nvmCurrentPath)) {
        return { found: true, path: nvmCurrentPath, method: 'nvm_env_current' };
      }
      attempts.push({
        path: nvmCurrentPath,
        reason: 'nvm_env_current',
        valid: false,
      });

      // Try common version directories
      const versionsDir = path.join(nvmDirEnv, 'versions', 'node');
      if (fs.existsSync(versionsDir)) {
        const versions = fs.readdirSync(versionsDir).sort().reverse();
        for (const version of versions) {
          const binPath = path.join(versionsDir, version, 'bin');
          if (fs.existsSync(binPath)) {
            return {
              found: true,
              path: binPath,
              method: 'nvm_env_latest',
              version,
            };
          }
        }
      }
    }

    // 4. which node
    const nodePath = await this.which('node');
    if (nodePath) {
      const nodeDir = path.dirname(nodePath);
      if (fs.existsSync(nodeDir)) {
        return { found: true, path: nodeDir, method: 'which_node' };
      }
      attempts.push({ path: nodeDir, reason: 'which_node', valid: false });
    }

    // 5. Traverse common NVM paths
    const nvmBase = this.isWindows
      ? path.join(os.homedir(), 'AppData', 'Roaming', 'nvm')
      : path.join(os.homedir(), '.nvm');

    const versionsDir = path.join(nvmBase, 'versions', 'node');
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir).sort().reverse();
      for (const version of versions) {
        const binPath = path.join(versionsDir, version, 'bin');
        if (fs.existsSync(binPath)) {
          return { found: true, path: binPath, method: 'nvm_scan', version };
        }
        attempts.push({ path: binPath, reason: 'nvm_scan', valid: false });
      }
    }

    // Not found - return default value
    return {
      found: false,
      path: null,
      attempts,
      fallback: this.isWindows
        ? null
        : path.join(os.homedir(), '.nvm', 'versions', 'node', 'bin'),
      error: this.generateNvmBinError(attempts),
    };
  }

  /**
   * Detect default project path
   */
  async detectProjectPath(existingPath) {
    const attempts = [];

    // 1. Check whether existing config is valid
    if (existingPath && fs.existsSync(existingPath)) {
      return { found: true, path: existingPath, method: 'existing_config' };
    }
    if (existingPath) {
      attempts.push({
        path: existingPath,
        reason: 'from_config',
        valid: false,
      });
    }

    // 2. Current working directory
    const cwd = process.cwd();
    if (fs.existsSync(cwd)) {
      return { found: true, path: cwd, method: 'current_directory' };
    }

    // 3. Common project directories
    const commonDirs = [
      'workspace',
      'projects',
      'dev',
      'code',
      'Work',
      'Documents',
    ];
    for (const dir of commonDirs) {
      const dirPath = path.join(os.homedir(), dir);
      if (fs.existsSync(dirPath)) {
        return {
          found: true,
          path: dirPath,
          method: 'common_directory',
          directory: dir,
        };
      }
      attempts.push({
        path: dirPath,
        reason: 'common_directory',
        valid: false,
      });
    }

    // 4. User home directory
    const homedir = os.homedir();
    return { found: true, path: homedir, method: 'home_directory' };
  }

  /**
   * Find executable using which/where command
   */
  which(command) {
    return new Promise((resolve) => {
      const cmd = this.isWindows ? 'where' : 'which';
      const child = spawn(cmd, [command], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 5000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && stdout.trim()) {
          // which/where may return multiple lines, use the first one
          const lines = stdout.trim().split('\n');
          resolve(lines[0].trim());
        } else {
          resolve(null);
        }
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  /**
   * Find file in NVM directories
   */
  async findInNvm(filename) {
    const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');

    if (!fs.existsSync(nvmBase)) {
      return null;
    }

    try {
      const versions = fs.readdirSync(nvmBase).sort().reverse();

      for (const version of versions) {
        const binPath = path.join(nvmBase, version, 'bin', filename);
        if (await this.isExecutable(binPath)) {
          return binPath;
        }
      }
    } catch (err) {
      // Ignore errors
    }

    return null;
  }

  /**
   * Find in PATH environment variable
   */
  async findInPathEnv(filename) {
    const pathEnv = process.env.PATH;
    if (!pathEnv) {
      return null;
    }

    const separators = this.isWindows ? ';' : ':';
    const directories = pathEnv.split(separators);

    for (const dir of directories) {
      const filePath = path.join(dir, filename);
      if (await this.isExecutable(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * Check whether file is executable
   */
  isExecutable(filePath) {
    return new Promise((resolve) => {
      fs.access(filePath, fs.constants.F_OK | fs.constants.X_OK, (err) => {
        if (err) {
          // On Windows, .cmd files do not require execute permission
          if (this.isWindows && filePath.endsWith('.cmd')) {
            fs.access(filePath, fs.constants.F_OK, (err2) => resolve(!err2));
          } else {
            resolve(false);
          }
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Infer nvmBin from claudePath
   */
  inferNvmBinFromClaudePath(claudePath) {
    // claudePath is usually at: ~/.nvm/versions/node/vXX.XX.X/bin/claude
    // nvmBin should be: ~/.nvm/versions/node/vXX.XX.X/bin
    const normalizedPath = claudePath.replace(/\\/g, '/');

    // Check whether path is under NVM directory
    const nvmPattern = /\.nvm\/versions\/node\/([^/]+)\/bin/;
    const match = normalizedPath.match(nvmPattern);

    if (match) {
      const version = match[1];
      return path.join(
        os.homedir(),
        '.nvm',
        'versions',
        'node',
        version,
        'bin',
      );
    }

    // If claudePath is inside a bin directory, use its parent directory
    const binDir = path.dirname(claudePath);
    if (binDir.endsWith('bin')) {
      return binDir;
    }

    return null;
  }

  /**
   * Generate claudePath error message
   */
  generateClaudePathError(attempts) {
    let message = 'Claude CLI not found. Tried the following:\n';
    for (const attempt of attempts.slice(0, 5)) {
      message += `  - ${attempt.path} (${attempt.reason})\n`;
    }
    if (attempts.length > 5) {
      message += `  ... and ${attempts.length - 5} more\n`;
    }
    message += '\nInstall Claude CLI first: https://claude.ai/claude-cli';
    return message;
  }

  /**
   * Generate nvmBin error message
   */
  generateNvmBinError(attempts) {
    let message = 'NVM bin directory not found.\n';
    message +=
      'This is optional but recommended for proper Node.js environment.\n';
    message += 'Install NVM: https://github.com/nvm-sh/nvm';
    return message;
  }

  /**
   * Apply detection results to config
   */
  applyDetectionResults(config, results) {
    const updates = [];
    const warnings = [];

    if (results.claudePath.found) {
      if (config.claudePath !== results.claudePath.path) {
        updates.push(
          `claudePath: ${config.claudePath} → ${results.claudePath.path}`,
        );
        config.claudePath = results.claudePath.path;
      }
    } else {
      warnings.push(`claudePath: ${results.claudePath.error}`);
    }

    if (results.nvmBin.found) {
      if (config.nvmBin !== results.nvmBin.path) {
        updates.push(`nvmBin: ${config.nvmBin} → ${results.nvmBin.path}`);
        config.nvmBin = results.nvmBin.path;
      }
    } else {
      warnings.push(`nvmBin: ${results.nvmBin.error}`);
    }

    if (results.defaultProjectPath.found) {
      if (config.defaultProjectPath !== results.defaultProjectPath.path) {
        updates.push(
          `defaultProjectPath: ${config.defaultProjectPath} → ${results.defaultProjectPath.path}`,
        );
        config.defaultProjectPath = results.defaultProjectPath.path;
      }
    }

    return { updates, warnings };
  }
}

module.exports = PathResolver;
