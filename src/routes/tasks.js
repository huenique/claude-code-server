const Validators = require('../utils/validators');

/**
 * Async task routes
 */
function createTaskRoutes(taskQueue) {
  const router = require('express').Router();

  // POST /api/tasks/async - Create async task
  router.post('/async', async (req, res) => {
    const validation = Validators.validateTaskCreate(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      const taskData = {
        ...validation.value,
        project_path:
          validation.value.project_path ||
          req.app.locals.config?.defaultProjectPath,
      };

      const task = await taskQueue.addTask(taskData);

      res.status(201).json({
        success: true,
        task,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/tasks/:id - Get task status
  router.get('/:id', async (req, res) => {
    try {
      const task = await taskQueue.taskStore.get(req.params.id);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      res.json({
        success: true,
        task,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // PATCH /api/tasks/:id/priority - Update task priority
  router.patch('/:id/priority', async (req, res) => {
    try {
      const { priority } = req.body;

      // Validate priority
      if (typeof priority !== 'number' || priority < 1 || priority > 10) {
        return res.status(400).json({
          success: false,
          error: 'Priority must be a number between 1 and 10',
        });
      }

      const task = await taskQueue.taskStore.get(req.params.id);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      // Only allow updates for tasks in pending or processing state
      if (task.status !== 'pending' && task.status !== 'processing') {
        return res.status(400).json({
          success: false,
          error: `Cannot modify priority for task with status: ${task.status}`,
        });
      }

      // Update priority
      await taskQueue.taskStore.update(req.params.id, { priority });

      res.json({
        success: true,
        message: 'Priority updated',
        task_id: req.params.id,
        old_priority: task.priority,
        new_priority: priority,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // DELETE /api/tasks/:id - Cancel task
  router.delete('/:id', async (req, res) => {
    try {
      const result = await taskQueue.cancelTask(req.params.id);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/tasks - List tasks
  router.get('/', async (req, res) => {
    try {
      const options = {
        status: req.query.status,
        limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      };

      const tasks = await taskQueue.taskStore.list(options);

      res.json({
        success: true,
        tasks,
        count: tasks.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/tasks/status - Get queue status
  router.get('/queue/status', async (req, res) => {
    try {
      const status = await taskQueue.getStatus();

      res.json({
        success: true,
        queue: status,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = createTaskRoutes;
