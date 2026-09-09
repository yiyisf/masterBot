import { NewConversationComposer } from '../../../../features/workspace/new-conversation-composer';
import { employeeWorkspaceEnabled } from '../../../../features/workspace/workspace-feature';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function NewConversationPage() {
  if (!employeeWorkspaceEnabled(process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED)) notFound();
  return <NewConversationComposer />;
}
