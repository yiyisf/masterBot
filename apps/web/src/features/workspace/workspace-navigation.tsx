'use client';

import { createContractClient } from '@cmaster/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useWorkspacePreferences } from './workspace-providers';

const client = createContractClient(process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '');
const copy = {
  'zh-CN': { workspace: 'Workspace', pending: '待处理', artifacts: 'Artifact Library' },
  'en-US': { workspace: 'Workspace', pending: 'Pending', artifacts: 'Artifact Library' },
} as const;

export function WorkspaceNavigation() {
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const summary = useQuery({
    queryKey: ['workspace', 'summary'],
    queryFn: async () => {
      const result = await client.GET('/api/v1/workspace/summary');
      if (!result.data) throw new Error('workspace_summary_unavailable');
      return result.data;
    },
  });
  return (
    <nav className="workspace-navigation" aria-label="Employee Workspace">
      <Link href="/workspace">{text.workspace}</Link>
      <Link href="/workspace/pending">
        {text.pending} <span className="navigation-count">{summary.data?.pendingActionCount ?? 0}</span>
      </Link>
      <Link href="/workspace/artifacts">{text.artifacts}</Link>
    </nav>
  );
}
