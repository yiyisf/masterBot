import { notFound } from 'next/navigation';

export default function DisabledAdminBoundary(): never {
  notFound();
}
