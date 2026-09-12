'use client';

import { createContractClient } from '@cmaster/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { useWorkspacePreferences } from './workspace-providers';

const client = createContractClient(process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '');
const copy = {
  'zh-CN': {
    workspace: 'Workspace', pending: '待处理', artifacts: 'Artifact Library',
    open: '打开导航', close: '关闭导航', navigation: '员工工作区',
  },
  'en-US': {
    workspace: 'Workspace', pending: 'Pending', artifacts: 'Artifact Library',
    open: 'Open navigation', close: 'Close navigation', navigation: 'Employee Workspace',
  },
} as const;

export function WorkspaceNavigation() {
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const pathname = usePathname() ?? '';
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const summary = useQuery({
    queryKey: ['workspace', 'summary'],
    queryFn: async () => {
      const result = await client.GET('/api/v1/workspace/summary');
      if (!result.data) throw new Error('workspace_summary_unavailable');
      return result.data;
    },
  });
  return (
    <nav className="workspace-navigation" aria-label={text.navigation}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return;
        setExpanded(false);
        toggleRef.current?.focus();
      }}>
      <button ref={toggleRef} type="button" className="workspace-navigation-toggle"
        aria-expanded={expanded} aria-controls="workspace-navigation-links"
        onClick={() => setExpanded((current) => !current)}>
        <span aria-hidden="true">☰</span> {expanded ? text.close : text.open}
      </button>
      <div id="workspace-navigation-links"
        className={`workspace-navigation-links${expanded ? ' expanded' : ''}`}>
        <Link href="/workspace" aria-current={pathname === '/workspace' ? 'page' : undefined}>
          {text.workspace}
        </Link>
        <Link href="/workspace/pending"
          aria-current={pathname.startsWith('/workspace/pending') ? 'page' : undefined}>
          {text.pending} <span className="navigation-count">
            {new Intl.NumberFormat(locale).format(summary.data?.pendingActionCount ?? 0)}
          </span>
        </Link>
        <Link href="/workspace/artifacts"
          aria-current={pathname.startsWith('/workspace/artifacts') ? 'page' : undefined}>
          {text.artifacts}
        </Link>
      </div>
    </nav>
  );
}
