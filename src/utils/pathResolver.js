const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * 路径解析器 - 自动检测 Claude 相关路径
 */
class PathResolver {
  constructor() {
    this.platform = process.platform;
    this.isWindows = this.platform === 'win32';
  }

  /**
   * 检测并验证所有路径
   */
  async detectAndValidate(config) {
    const results = {
      claudePath: await this.detectClaudePath(config.claudePath),
      nvmBin: null, // 需要在 claudePath 检测后处理
      defaultProjectPath: await this.detectProjectPath(config.defaultProjectPath),
    };

    // nvmBin 依赖 claudePath 的结果
    results.nvmBin = await this.detectNvmBin(config.nvmBin, results.claudePath);

    return results;
  }

  /**
   * 检测 Claude CLI 路径
   */
  async detectClaudePath(existingPath) {
    const attempts = [];

    // 1. 检查现有配置是否有效
    if (existingPath && await this.isExecutable(existingPath)) {
      return { found: true, path: existingPath, method: 'existing_config' };
    }
    if (existingPath) {
      attempts.push({ path: existingPath, reason: 'from_config', valid: false });
    }

    // 2. 使用 which/where 命令
    const whichPath = await this.which('claude');
    if (whichPath && await this.isExecutable(whichPath)) {
      return { found: true, path: whichPath, method: 'which_command' };
    }
    if (whichPath) attempts.push({ path: whichPath, reason: 'which_command', valid: false });

    // 3. 遍历 NVM 目录
    const nvmPath = await this.findInNvm('claude');
    if (nvmPath) {
      return { found: true, path: nvmPath, method: 'nvm_scan' };
    }

    // 4. 检查常见系统路径
    const systemPaths = this.isWindows
      ? [
          path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(process.env.ProgramFiles || '', 'claude', 'claude.exe'),
          path.join(process.env['ProgramFiles(x86)'] || '', 'claude', 'claude.exe'),
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

    // 5. 检查 PATH 环境变量
    const pathEnvPath = await this.findInPathEnv('claude');
    if (pathEnvPath) {
      return { found: true, path: pathEnvPath, method: 'path_env' };
    }

    // 未找到
    return {
      found: false,
      path: null,
      attempts,
      error: this.generateClaudePathError(attempts),
    };
  }

  /**
   * 检测 NVM bin 目录
   */
  async detectNvmBin(existingPath, claudePathResult) {
    const attempts = [];

    // 1. 检查现有配置是否有效
    if (existingPath && fs.existsSync(existingPath)) {
      return { found: true, path: existingPath, method: 'existing_config' };
    }
    if (existingPath) {
      attempts.push({ path: existingPath, reason: 'from_config', valid: false });
    }

    // 2. 从 claudePath 推断
    if (claudePathResult.found && claudePathResult.path) {
      const inferred = this.inferNvmBinFromClaudePath(claudePathResult.path);
      if (inferred && fs.existsSync(inferred)) {
        return { found: true, path: inferred, method: 'inferred_from_claude' };
      }
      if (inferred) {
        attempts.push({ path: inferred, reason: 'inferred_from_claude', valid: false });
      }
    }

    // 3. 使用 NVM 环境变量
    const nvmDirEnv = process.env.NVM_DIR;
    if (nvmDirEnv) {
      const currentVersion = process.env.NVM_CURRENT || process.env.NVM_NODEJS_ORG_MIRROR;
      // 尝试读取当前激活的版本
      const nvmCurrentPath = path.join(nvmDirEnv, 'current', 'bin');
      if (fs.existsSync(nvmCurrentPath)) {
        return { found: true, path: nvmCurrentPath, method: 'nvm_env_current' };
      }
      attempts.push({ path: nvmCurrentPath, reason: 'nvm_env_current', valid: false });

      // 尝试常见的版本目录
      const versionsDir = path.join(nvmDirEnv, 'versions', 'node');
      if (fs.existsSync(versionsDir)) {
        const versions = fs.readdirSync(versionsDir).sort().reverse();
        for (const version of versions) {
          const binPath = path.join(versionsDir, version, 'bin');
          if (fs.existsSync(binPath)) {
            return { found: true, path: binPath, method: 'nvm_env_latest', version };
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

    // 5. 遍历常见 NVM 路径
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

    // 未找到 - 返回默认值
    return {
      found: false,
      path: null,
      attempts,
      fallback: this.isWindows ? null : path.join(os.homedir(), '.nvm', 'versions', 'node', 'bin'),
      error: this.generateNvmBinError(attempts),
    };
  }

  /**
   * 检测默认项目路径
   */
  async detectProjectPath(existingPath) {
    const attempts = [];

    // 1. 检查现有配置是否有效
    if (existingPath && fs.existsSync(existingPath)) {
      return { found: true, path: existingPath, method: 'existing_config' };
    }
    if (existingPath) {
      attempts.push({ path: existingPath, reason: 'from_config', valid: false });
    }

    // 2. 当前工作目录
    const cwd = process.cwd();
    if (fs.existsSync(cwd)) {
      return { found: true, path: cwd, method: 'current_directory' };
    }

    // 3. 常见项目目录
    const commonDirs = ['workspace', 'projects', 'dev', 'code', 'Work', 'Documents'];
    for (const dir of commonDirs) {
      const dirPath = path.join(os.homedir(), dir);
      if (fs.existsSync(dirPath)) {
        return { found: true, path: dirPath, method: 'common_directory', directory: dir };
      }
      attempts.push({ path: dirPath, reason: 'common_directory', valid: false });
    }

    // 4. 用户主目录
    const homedir = os.homedir();
    return { found: true, path: homedir, method: 'home_directory' };
  }

  /**
   * 使用 which/where 命令查找可执行文件
   */
  which(command) {
    return new Promise((resolve) => {
      const cmd = this.isWindows ? 'where' : 'which';
      const child = spawn(cmd, [command], { stdio: ['ignore', 'pipe', 'pipe'] });

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
          // which/where 可能返回多行，取第一个
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
   * 在 NVM 目录中查找文件
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
      // 忽略错误
    }

    return null;
  }

  /**
   * 在 PATH 环境变量中查找
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
   * 检查文件是否可执行
   */
  isExecutable(filePath) {
    return new Promise((resolve) => {
      fs.access(filePath, fs.constants.F_OK | fs.constants.X_OK, (err) => {
        if (err) {
          // 在 Windows 上，.cmd 文件不需要 X 权限
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
   * 从 claudePath 推断 nvmBin
   */
  inferNvmBinFromClaudePath(claudePath) {
    // claudePath 通常在: ~/.nvm/versions/node/vXX.XX.X/bin/claude
    // nvmBin 应该是: ~/.nvm/versions/node/vXX.XX.X/bin
    const normalizedPath = claudePath.replace(/\\/g, '/');

    // 检查是否在 NVM 目录中
    const nvmPattern = /\.nvm\/versions\/node\/([^/]+)\/bin/;
    const match = normalizedPath.match(nvmPattern);

    if (match) {
      const version = match[1];
      return path.join(os.homedir(), '.nvm', 'versions', 'node', version, 'bin');
    }

    // 如果 claudePath 在某个 bin 目录中，取其父目录
    const binDir = path.dirname(claudePath);
    if (binDir.endsWith('bin')) {
      return binDir;
    }

    return null;
  }

  /**
   * 生成 claudePath 错误信息
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
   * 生成 nvmBin 错误信息
   */
  generateNvmBinError(attempts) {
    let message = 'NVM bin directory not found.\n';
    message += 'This is optional but recommended for proper Node.js environment.\n';
    message += 'Install NVM: https://github.com/nvm-sh/nvm';
    return message;
  }

  /**
   * 将检测结果应用到配置
   */
  applyDetectionResults(config, results) {
    const updates = [];
    const warnings = [];

    if (results.claudePath.found) {
      if (config.claudePath !== results.claudePath.path) {
        updates.push(`claudePath: ${config.claudePath} → ${results.claudePath.path}`);
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
        updates.push(`defaultProjectPath: ${config.defaultProjectPath} → ${results.defaultProjectPath.path}`);
        config.defaultProjectPath = results.defaultProjectPath.path;
      }
    }

    return { updates, warnings };
  }
}

module.exports = PathResolver;
