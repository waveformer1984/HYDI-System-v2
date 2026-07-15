/**
 * Unit tests for lib/heidi-tools.ts — the native Anthropic tool definitions.
 * Each tool must map 1:1 to an ActionExecutor action type and expose a valid
 * JSON schema, so the model's tool calls deserialize into executable actions.
 */

import { HEIDI_TOOLS } from '../../lib/heidi-tools';

// Action types ActionExecutor.execute() switches on.
const EXECUTOR_ACTION_TYPES = [
  'create_task',
  'fetch_data',
  'update_database',
  'schedule_event',
  'send_email',
];

describe('lib/heidi-tools HEIDI_TOOLS', () => {
  it('defines exactly the tools ActionExecutor can run', () => {
    const names = HEIDI_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([...EXECUTOR_ACTION_TYPES].sort());
  });

  it('every tool name maps 1:1 to an executor action type', () => {
    for (const tool of HEIDI_TOOLS) {
      expect(EXECUTOR_ACTION_TYPES).toContain(tool.name);
    }
  });

  it('every tool exposes a non-empty description and an object input schema', () => {
    for (const tool of HEIDI_TOOLS) {
      expect(typeof tool.description).toBe('string');
      expect((tool.description as string).length).toBeGreaterThan(0);
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
    }
  });

  it('declares required fields as a subset of declared properties', () => {
    for (const tool of HEIDI_TOOLS) {
      const props = Object.keys(tool.input_schema.properties ?? {});
      const required = (tool.input_schema.required ?? []) as string[];
      expect(Array.isArray(required)).toBe(true);
      for (const field of required) {
        expect(props).toContain(field);
      }
    }
  });

  it('pins the key required fields per tool', () => {
    const required = (name: string) =>
      (HEIDI_TOOLS.find((t) => t.name === name)!.input_schema.required ?? []) as string[];
    expect(required('create_task')).toContain('task_name');
    expect(required('fetch_data')).toContain('table');
    expect(required('update_database')).toEqual(expect.arrayContaining(['table', 'values', 'match']));
    expect(required('schedule_event')).toContain('scheduled_for');
    expect(required('send_email')).toEqual(expect.arrayContaining(['to', 'subject', 'body']));
  });
});
