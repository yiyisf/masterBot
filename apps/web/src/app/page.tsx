import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">CMaster Bot</p>
      <h1>下一代 Workspace 基础已隔离</h1>
      <p>此应用是新架构组合根，不复用旧 Chat UI。</p>
      <Link className="button" href="/workspace">
        打开 Employee Workspace
      </Link>
      {' '}
      <Link className="button" href="/system-status">
        查看系统状态
      </Link>
    </main>
  );
}
