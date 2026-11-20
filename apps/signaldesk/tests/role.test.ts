import { describe, expect, it } from 'vitest';
import { roleAllowsAdmin } from '@/lib/workspace/access';

describe('workspace roles', () => {
  it('owner and admin can administer', () => {
    expect(roleAllowsAdmin('owner')).toBe(true);
    expect(roleAllowsAdmin('admin')).toBe(true);
    expect(roleAllowsAdmin('member')).toBe(false);
  });
});