import { ConversationOverview } from '../../../../features/workspace/conversation-overview';
import { employeeWorkspaceEnabled } from '../../../../features/workspace/workspace-feature';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: Readonly<{ params: Promise<{ conversationId: string }> }>) {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) notFound();
  const { conversationId } = await params;
  return <ConversationOverview conversationId={conversationId} />;
}
