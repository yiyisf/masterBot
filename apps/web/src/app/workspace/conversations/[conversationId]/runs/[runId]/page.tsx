import { notFound } from 'next/navigation';
import { ConversationOverview } from '../../../../../../features/workspace/conversation-overview';
import { RunDetail } from '../../../../../../features/workspace/run-detail';
import { employeeWorkspaceEnabled } from '../../../../../../features/workspace/workspace-feature';

export const dynamic = 'force-dynamic';

export default async function ConversationRunPage({
  params,
}: Readonly<{ params: Promise<{ conversationId: string; runId: string }> }>) {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) notFound();
  const { conversationId, runId } = await params;
  return (
    <main className="conversation-detail-layout">
      <ConversationOverview conversationId={conversationId} embedded />
      <RunDetail conversationId={conversationId} runId={runId} embedded />
    </main>
  );
}
