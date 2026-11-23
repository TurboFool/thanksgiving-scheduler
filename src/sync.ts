import type { ThymeLineWorkspace } from './types';

export interface PullResult {
  exists: boolean;
  syncVersion: number;
  updatedAt: number;
  workspace: ThymeLineWorkspace | null;
}

export interface PushResult {
  ok: boolean;
  conflict?: boolean;
  syncVersion?: number;
  updatedAt?: number;
  remoteWorkspace?: ThymeLineWorkspace;
}

export async function pullCloudWorkspace(passcode: string): Promise<PullResult> {
  const res = await fetch('/api/sync', {
    method: 'GET',
    headers: {
      'X-Sync-Passcode': passcode.trim(),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Sync check-in failed (${res.status})`);
  }

  return (await res.json()) as PullResult;
}

export async function pushCloudWorkspace(
  passcode: string,
  workspace: ThymeLineWorkspace,
  force = false
): Promise<PushResult> {
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Passcode': passcode.trim(),
    },
    body: JSON.stringify({
      expectedSyncVersion: workspace.syncVersion,
      force,
      workspace,
    }),
  });

  if (res.status === 409) {
    const body = await res.json();
    return {
      ok: false,
      conflict: true,
      syncVersion: body.remoteSyncVersion,
      remoteWorkspace: body.remoteWorkspace,
    };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Cloud save failed (${res.status})`);
  }

  const data = (await res.json()) as { syncVersion: number; updatedAt: number };
  return {
    ok: true,
    syncVersion: data.syncVersion,
    updatedAt: data.updatedAt,
  };
}
