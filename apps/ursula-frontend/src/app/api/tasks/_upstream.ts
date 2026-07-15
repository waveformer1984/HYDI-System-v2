import { NextResponse } from 'next/server';

const PROJECT_OPS_BASE_URL =
  process.env.PROJECT_OPS_URL ||
  process.env.NEXT_PUBLIC_PROJECT_OPS_URL ||
  'http://localhost:3100';

export function getProjectOpsBaseUrl(): string {
  return PROJECT_OPS_BASE_URL.replace(/\/$/, '');
}

export async function proxyJson(
  path: string,
  init?: RequestInit
): Promise<NextResponse> {
  try {
    const response = await fetch(`${getProjectOpsBaseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });

    const text = await response.text();
    let payload: any = {};

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Upstream request failed',
      },
      { status: 502 }
    );
  }
}
