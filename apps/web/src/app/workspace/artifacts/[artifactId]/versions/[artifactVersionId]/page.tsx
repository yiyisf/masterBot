import { notFound } from 'next/navigation';
import { ArtifactLibrary } from '../../../../../../features/artifacts/artifact-library';
import { employeeWorkspaceEnabled } from '../../../../../../features/workspace/workspace-feature';

export const dynamic = 'force-dynamic';

export default async function ArtifactVersionPage({
  params,
}: Readonly<{
  params: Promise<{ artifactId: string; artifactVersionId: string }>;
}>) {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) notFound();
  const selected = await params;
  return <ArtifactLibrary selected={selected} />;
}
