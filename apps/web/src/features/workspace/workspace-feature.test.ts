import { describe, expect, it } from 'vitest';
import { employeeWorkspaceEnabled } from './workspace-feature';

describe('Employee Workspace Web flag', () => {
  it('defaults off and accepts only typed boolean strings', () => {
    expect(employeeWorkspaceEnabled(undefined)).toBe(false);
    expect(employeeWorkspaceEnabled('false')).toBe(false);
    expect(employeeWorkspaceEnabled('true')).toBe(true);
    expect(() => employeeWorkspaceEnabled('yes')).toThrow('CMASTER_EMPLOYEE_WORKSPACE_ENABLED');
  });
});
