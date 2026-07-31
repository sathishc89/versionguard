import { fetchAuthSession } from 'aws-amplify/auth';
import { ApiClient, RuntimeConfig } from './types';

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `vg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createApiClient(config: RuntimeConfig): ApiClient {
  return async <T>(path: string, options: RequestInit = {}) => {
    const clientRequestId = createRequestId();
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken.toString();
    const url = `${config.apiUrl.replace(/\/$/, '')}${path}`;
    console.info('[VersionGuard API]', { clientRequestId, method: options.method ?? 'GET', path });
    const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', 'x-versionguard-client-request-id': clientRequestId, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } });
    const serverRequestId = response.headers.get('x-versionguard-request-id');
    console.info('[VersionGuard API result]', { clientRequestId, serverRequestId, status: response.status, path });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string; code?: string; selectedVersion?: number; latestVersion?: number; latestFileName?: string; requestId?: string };
      const error = Object.assign(new Error(body.message ?? 'Request failed.'), { status: response.status, ...body });
      console.error('[VersionGuard API error]', { clientRequestId, serverRequestId, status: response.status, path, message: error.message });
      throw error;
    }
    return response.json() as Promise<T>;
  };
}

export async function uploadWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('content-type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status}): ${request.responseText || 'S3 rejected the upload.'}`));
    request.onerror = () => reject(new Error('Upload failed: the browser could not reach S3.'));
    request.send(file);
  });
}
