import { DocumentRecord, MetricsResponse, VersionRecord } from '@versionguard/shared';

export type RuntimeConfig = { region: string; userPoolId: string; userPoolClientId: string; apiUrl: string; cloudFrontUrl: string };
export type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;
export type AppData = { documents: DocumentRecord[]; metrics: MetricsResponse; versions: Record<string, VersionRecord[]> };
