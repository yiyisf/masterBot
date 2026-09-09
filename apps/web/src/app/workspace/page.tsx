import { EmployeeWorkspaceHome } from '../../features/workspace/employee-workspace-home';
import { LegacyWorkspace } from '../../features/workspace/legacy-workspace';
import { employeeWorkspaceEnabled } from '../../features/workspace/workspace-feature';

export const dynamic = 'force-dynamic';

export default function WorkspacePage() {
  return employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)
    ? <EmployeeWorkspaceHome />
    : <LegacyWorkspace />;
}
