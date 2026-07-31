import { fetchAuthSession } from 'aws-amplify/auth';
import { ApiClient, RuntimeConfig } from './types';

export function createApiClient(config: RuntimeConfig): ApiClient {
  return async <T>(path: string, options: RequestInit = {}) => {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken.toString();
    const response = await fetch(`${config.apiUrl.replace(/\/$/, '')}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string; code?: string; selectedVersion?: number; latestVersion?: number; latestFileName?: string };
      const error = Object.assign(new Error(body.message ?? 'Request failed.'), { status: response.status, ...body });
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
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Upload failed.'));
    request.onerror = () => reject(new Error('Upload failed.'));
    request.send(file);
  });
}
