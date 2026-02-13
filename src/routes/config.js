const fs = require('fs');
const path = require('path');

/**
 * Configuration route
 */
function createConfigRoute(configPath) {
  return (req, res) => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    res.json({
      port: config.port,
      defaultProjectPath: config.defaultProjectPath,
      defaultModel: config.defaultModel,
      rateLimit: config.rateLimit,
      statistics: config.statistics,
      version: require('../../package.json').version,
    });
  };
}

module.exports = createConfigRoute;
