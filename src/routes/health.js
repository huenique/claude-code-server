/**
 * Health check route
 */
function createHealthRoute() {
  return (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
    });
  };
}

module.exports = createHealthRoute;
