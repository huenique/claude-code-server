const Joi = require('joi');

/**
 * Validation utilities
 */
class Validators {
  /**
   * Validate Claude API request
   */
  static validateClaudeRequest(data) {
    const schema = Joi.object({
      prompt: Joi.string().required().min(1),
      project_path: Joi.string().allow('', null),
      model: Joi.string().allow('', null),
      session_id: Joi.string().allow('', null),
      system_prompt: Joi.string().allow('', null),
      max_budget_usd: Joi.number().min(0).optional(),
      allowed_tools: Joi.array().items(Joi.string()).optional(),
      disallowed_tools: Joi.array().items(Joi.string()).optional(),
      agent: Joi.string().allow('', null),
      mcp_config: Joi.string().allow('', null).optional(),
      stream: Joi.boolean().optional(),
      async: Joi.boolean().optional(),
      webhook_url: Joi.string().uri().optional(),
      priority: Joi.number().min(1).max(10).optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate session creation request
   */
  static validateSessionCreate(data) {
    const schema = Joi.object({
      project_path: Joi.string().required(),
      model: Joi.string().optional(),
      metadata: Joi.object().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate session continuation request
   */
  static validateSessionContinue(data) {
    const schema = Joi.object({
      prompt: Joi.string().required().min(1),
      system_prompt: Joi.string().allow('', null).optional(),
      max_budget_usd: Joi.number().min(0).optional(),
      stream: Joi.boolean().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate async task creation request
   */
  static validateTaskCreate(data) {
    const schema = Joi.object({
      prompt: Joi.string().required().min(1),
      project_path: Joi.string().allow('', null),
      model: Joi.string().optional(),
      priority: Joi.number().min(1).max(10).optional(),
      metadata: Joi.object().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate batch request
   */
  static validateBatchRequest(data) {
    const schema = Joi.object({
      prompts: Joi.array().items(Joi.string().min(1)).min(1).max(10).required(),
      project_path: Joi.string().allow('', null),
      model: Joi.string().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate search query
   */
  static validateSearchQuery(query) {
    const schema = Joi.object({
      q: Joi.string().required().min(1),
      limit: Joi.number().min(1).max(100).optional(),
    });

    const { error, value } = schema.validate(query);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }
}

module.exports = Validators;
