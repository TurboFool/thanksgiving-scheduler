interface R2ObjectLike {
  text(): Promise<string>;
}

interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType: string } }): Promise<void>;
}

interface KVNamespaceLike {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  SYNC_PASSCODE?: string;
  THYMELINE_BUCKET?: R2BucketLike;
  THYMELINE_KV?: KVNamespaceLike;
}

interface PagesContext {
  request: Request;
  env: Env;
}

const STORAGE_OBJECT_KEY = 'thymeline-workspace.json';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function checkAuth(request: Request, env: Env): Response | null {
  if (!env.SYNC_PASSCODE) {
    return jsonResponse(
      { error: 'SYNC_PASSCODE is not configured in Cloudflare Pages environment variables.' },
      503
    );
  }
  const provided = request.headers.get('X-Sync-Passcode') ?? '';
  if (provided !== env.SYNC_PASSCODE) {
    return jsonResponse({ error: 'Invalid sync passcode.' }, 401);
  }
  return null;
}

async function readStoredJson(env: Env): Promise<string | null> {
  if (env.THYMELINE_BUCKET) {
    const obj = await env.THYMELINE_BUCKET.get(STORAGE_OBJECT_KEY);
    return obj ? obj.text() : null;
  }
  if (env.THYMELINE_KV) {
    return env.THYMELINE_KV.get(STORAGE_OBJECT_KEY, 'text');
  }
  throw new Error('Neither THYMELINE_BUCKET (R2) nor THYMELINE_KV (KV) is bound.');
}

async function writeStoredJson(env: Env, content: string): Promise<void> {
  if (env.THYMELINE_BUCKET) {
    await env.THYMELINE_BUCKET.put(STORAGE_OBJECT_KEY, content, {
      httpMetadata: { contentType: 'application/json' },
    });
    return;
  }
  if (env.THYMELINE_KV) {
    await env.THYMELINE_KV.put(STORAGE_OBJECT_KEY, content);
    return;
  }
  throw new Error('Neither THYMELINE_BUCKET (R2) nor THYMELINE_KV (KV) is bound.');
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const authErr = checkAuth(context.request, context.env);
  if (authErr) return authErr;

  try {
    const raw = await readStoredJson(context.env);
    if (!raw) {
      return jsonResponse({ exists: false, workspace: null }, 200);
    }
    const workspace = JSON.parse(raw);
    return jsonResponse({
      exists: true,
      syncVersion: workspace.syncVersion ?? 0,
      updatedAt: workspace.updatedAt ?? 0,
      workspace,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Failed to read cloud workspace.' },
      500
    );
  }
}

export async function onRequestPut(context: PagesContext): Promise<Response> {
  const authErr = checkAuth(context.request, context.env);
  if (authErr) return authErr;

  try {
    const payload = (await context.request.json()) as {
      expectedSyncVersion?: number;
      force?: boolean;
      workspace?: Record<string, unknown>;
    };

    if (!payload.workspace || typeof payload.workspace !== 'object') {
      return jsonResponse({ error: 'Missing workspace payload.' }, 400);
    }

    const existingRaw = await readStoredJson(context.env);
    const existing = existingRaw ? (JSON.parse(existingRaw) as { syncVersion?: number }) : null;
    const remoteVersion = existing?.syncVersion ?? 0;

    if (
      existing &&
      !payload.force &&
      typeof payload.expectedSyncVersion === 'number' &&
      payload.expectedSyncVersion !== remoteVersion
    ) {
      return jsonResponse(
        {
          error: 'Cloud workspace has newer changes from another device.',
          remoteSyncVersion: remoteVersion,
          remoteWorkspace: existing,
        },
        409
      );
    }

    const nextVersion = remoteVersion + 1;
    const updatedAt = Date.now();
    const nextWorkspace = {
      ...payload.workspace,
      syncVersion: nextVersion,
      updatedAt,
    };

    await writeStoredJson(context.env, JSON.stringify(nextWorkspace));

    return jsonResponse({
      syncVersion: nextVersion,
      updatedAt,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Failed to save cloud workspace.' },
      500
    );
  }
}
