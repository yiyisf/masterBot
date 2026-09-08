import type { ReactNode } from 'react';

/** Separate Admin Console boundary; trusted administrative capability is introduced later. */
export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
