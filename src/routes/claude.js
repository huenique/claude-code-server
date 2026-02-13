const Validators = require('../utils/validators');
const crypto = require('crypto');

/**
 * Claude API routes
 */
function createClaudeRoutes(
  claudeExecutor,
  config,
  taskQueue = null,
  sessionManager = null,
) {
  const router = require('express').Router();

  // POST /api/claude - Single request (supports sync and async)
  router.post('/', async (req, res) => {
    const {
      prompt,
      project_path,
      model,
      session_id,
      system_prompt,
      max_budget_usd,
      allowed_tools,
      disallowed_tools,
      agent,
      mcp_config,
      stream,
      async: isAsync,
      webhook_url,
      priority,
    } = req.body;

    // Validate request
    const validation = Validators.validateClaudeRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const projectPath = project_path || config.defaultProjectPath;

    // Streaming output is not supported yet
    if (stream) {
      return res.status(501).json({
        success: false,
        error: 'Streaming is not yet implemented',
      });
    }

    // Auto-create session (if no session_id)
    let sessionId = session_id;
    if (!sessionId && sessionManager) {
      try {
        const session = await sessionManager.createSession({
          project_path: projectPath,
          model: model || config.defaultModel,
          metadata: {
            auto_created: true,
          },
        });
        sessionId = session.id;
      } catch (error) {
        // If session creation fails, continue without session
        console.error('Failed to auto-create session:', error.message);
      }
    }

    const shouldFallbackToAsyncOnWindows =
      process.platform === 'win32' && isAsync === false;
    const useAsyncMode = Boolean(isAsync) || shouldFallbackToAsyncOnWindows;

    // Async execution mode
    if (useAsyncMode) {
      if (!taskQueue) {
        return res.status(501).json({
          success: false,
          error:
            'Async execution is not available (task queue not initialized)',
        });
      }

      try {
        // Create async task
        const task = await taskQueue.addTask({
          prompt,
          project_path: projectPath,
          model,
          priority: priority || 5, // Default priority: 5
          metadata: {
            webhook_url: webhook_url || config.webhook?.defaultUrl,
            session_id: sessionId,
            system_prompt,
            max_budget_usd,
            allowed_tools,
            disallowed_tools,
            agent,
            mcp_config,
          },
        });

        return res.status(202).json({
          success: true,
          message: shouldFallbackToAsyncOnWindows
            ? 'Synchronous execution is not supported on Windows; request was queued as async task'
            : 'Task created successfully',
          task_id: task.id,
          status: task.status,
          priority: task.priority,
          session_id: sessionId, // Return session_id
          webhook_url: task.metadata.webhook_url,
          fallback_async: shouldFallbackToAsyncOnWindows,
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }

    // Sync execution mode (default)
    const result = await claudeExecutor.execute({
      prompt,
      projectPath,
      model,
      sessionId: sessionId,
      systemPrompt: system_prompt,
      maxBudgetUsd: max_budget_usd,
      allowedTools: allowed_tools,
      disallowedTools: disallowed_tools,
      agent,
      mcpConfig: mcp_config,
      stream,
    });

    // Return result (including session_id)
    const statusCode = result.success ? 200 : 500;
    const responseData = result.success
      ? {
          ...result,
          session_id: sessionId, // Return session_id
        }
      : result;

    res.status(statusCode).json(responseData);
  });

  // POST /api/claude/batch - Batch processing
  router.post('/batch', async (req, res) => {
    const validation = Validators.validateBatchRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const { prompts, project_path, model } = validation.value;
    const projectPath = project_path || config.defaultProjectPath;

    // Execute all requests concurrently
    const promises = prompts.map((prompt) =>
      claudeExecutor.execute({
        prompt,
        projectPath,
        model,
      }),
    );

    try {
      const results = await Promise.all(promises);

      // Aggregate results
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      const totalCost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
      const totalDuration = results.reduce(
        (sum, r) => sum + (r.duration_ms || 0),
        0,
      );

      res.json({
        success: true,
        results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failCount,
          total_cost_usd: totalCost,
          total_duration_ms: totalDuration,
        },
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

module.exports = createClaudeRoutes;
