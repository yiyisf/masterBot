import { notFound } from 'next/navigation';
import { ArtifactLibrary } from '../../../features/artifacts/artifact-library';
import { employeeWorkspaceEnabled } from '../../../features/workspace/workspace-feature';

export const dynamic = 'force-dynamic';

export default function ArtifactLibraryPage() {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) notFound();
  return <ArtifactLibrary />;
}
