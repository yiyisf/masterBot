'use client';

import { createContractClient, type SystemStatus } from '@cmaster/contracts';
import { useEffect, useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? 'http://localhost:3100';

export default function SystemStatusPage() {
  const [status, setStatus] = useState<SystemStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const client = createContractClient(apiUrl);
    void client.GET('/api/v1/system/status').then(({ data, error: responseError }) => {
      if (responseError || !data) {
        setError('无法读取下一代 Server 状态。请确认 Feature Flag 和 API 地址。');
        return;
      }
      setStatus(data);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '未知网络错误');
    });
  }, []);

  return (
    <main>
      <p className="eyebrow">Workspace Foundation</p>
      <h1>系统状态</h1>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!error && !status ? <p>正在连接新 Server…</p> : null}
      {status ? (
        <dl className="statusGrid">
          <div><dt>Contract</dt><dd>{status.contractVersion}</dd></div>
          <div><dt>Role</dt><dd>{status.role}</dd></div>
          <div><dt>Service</dt><dd>{status.status}</dd></div>
          <div><dt>PostgreSQL</dt><dd>{status.postgres}</dd></div>
          <div><dt>Feature</dt><dd>{status.nextArchitectureEnabled ? 'enabled' : 'disabled'}</dd></div>
        </dl>
      ) : null}
    </main>
  );
}
