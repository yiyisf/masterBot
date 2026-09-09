import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { WorkspaceProviders } from '../features/workspace/workspace-providers';
import './styles.css';

export const metadata: Metadata = {
  title: 'CMaster Employee Workspace',
  description: 'Enterprise Assistant employee workspace',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body><WorkspaceProviders>{children}</WorkspaceProviders></body>
    </html>
  );
}
