import { notFound } from 'next/navigation';
import { PendingWorkspace } from '../../../features/workspace/pending-workspace';
import { employeeWorkspaceEnabled } from '../../../features/workspace/workspace-feature';

export const dynamic = 'force-dynamic';

export default function PendingPage() {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) notFound();
  return <PendingWorkspace />;
}
