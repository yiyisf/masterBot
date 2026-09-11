import type { ReactNode } from 'react';
import { WorkspaceNavigation } from '../../features/workspace/workspace-navigation';
import { employeeWorkspaceEnabled } from '../../features/workspace/workspace-feature';

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) return children;
  return <><WorkspaceNavigation />{children}</>;
}
