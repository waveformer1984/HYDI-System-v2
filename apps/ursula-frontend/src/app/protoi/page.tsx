'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Proto.I.Y is canonical at protoforge-applications/proto-yi — the old
 *  in-memory mock is retired; this route forwards to its workspace. */
export default function ProtoiRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/apps/proto-yi'); }, [router]);
  return null;
}
