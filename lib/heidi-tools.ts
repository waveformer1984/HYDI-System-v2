/**
 * HEIDI TOOLS
 *
 * Native Anthropic tool definitions mapped 1:1 to ActionExecutor handlers.
 * Replaces the brittle "ask the model for a JSON blob and parse it" approach
 * with the model's native tool-use API. Each tool name equals the
 * ActionExecutor action `type`, and the tool input is the action `payload`.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const HEIDI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description:
      'Create a task/work item in the actions queue. Use when the user wants something tracked or done later.',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'Short identifier/title for the task' },
        details: { type: 'string', description: 'Optional description of the task' },
      },
      required: ['task_name'],
    },
  },
  {
    name: 'fetch_data',
    description:
      'Read rows from an allowlisted table (memories, actions, sessions, leads, quotes, proposals, system_dashboard). Use to answer questions grounded in real data.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table to read from (must be allowlisted)' },
        limit: { type: 'number', description: 'Max rows to return (default 10)' },
        filter: { type: 'object', description: 'Optional equality filters as key/value pairs' },
      },
      required: ['table'],
    },
  },
  {
    name: 'update_database',
    description:
      'Update rows in an allowlisted writable table (currently: sessions). Requires "values" and a non-empty "match".',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Writable table name' },
        values: { type: 'object', description: 'Columns to set' },
        match: { type: 'object', description: 'Equality filter selecting the rows to update' },
      },
      required: ['table', 'values', 'match'],
    },
  },
  {
    name: 'schedule_event',
    description: 'Persist a scheduled event/intent with an ISO timestamp.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Event name' },
        scheduled_for: { type: 'string', description: 'ISO 8601 timestamp for when the event should occur' },
      },
      required: ['scheduled_for'],
    },
  },
  {
    name: 'send_email',
    description:
      'Send an email (requires RESEND_API_KEY + EMAIL_FROM to be configured; otherwise returns an explicit error).',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
];
