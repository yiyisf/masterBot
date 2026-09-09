export function employeeWorkspaceEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('CMASTER_EMPLOYEE_WORKSPACE_ENABLED must be true or false');
}
