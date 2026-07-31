import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: vi.fn(async () => ({ tokens: { accessToken: { toString: () => 'token' } } })) }));
const config = { region: 'us-east-1', userPoolId: 'pool', userPoolClientId: 'client', apiUrl: 'https://api.example', cloudFrontUrl: 'https://app.example' };
const documentRecord = { userId: 'user', entityKey: 'DOC#1', documentId: '1', name: 'Project Plan', description: 'Planning', latestVersionNumber: 2, nextVersionNumber: 3, versionCount: 2, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const versions = [{ documentId: '1', versionNumber: 1, versionId: '1#1', userId: 'user', originalFileName: 'plan.docx', safeFileName: 'plan.docx', s3Key: 'key1', contentType: 'application/octet-stream', size: 10, sha256: '1'.repeat(64), status: 'COMPLETE', uploadedAt: '2026-07-30T00:00:00.000Z' }, { documentId: '1', versionNumber: 2, versionId: '1#2', userId: 'user', originalFileName: 'plan.docx', safeFileName: 'plan.docx', s3Key: 'key2', contentType: 'application/octet-stream', size: 10, sha256: '2'.repeat(64), status: 'COMPLETE', uploadedAt: '2026-07-31T00:00:00.000Z' }];

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async (url: string) => { const path = new URL(url).pathname; const body = path === '/documents' ? [documentRecord] : path === '/metrics' ? { totalDocuments: 1, totalVersions: 2, totalShares: 0, staleWarnings: 0, forcedOlderShares: 0, latestSharePercentage: 0 } : path === '/documents/1/versions' ? versions : {}; return { ok: true, json: async () => body }; })); });

describe('dashboard', () => {
  it('renders metrics, documents, and latest badge through history', async () => { render(<App config={config} />); expect(await screen.findByText('Project Plan')).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'History' })); expect(await screen.findByText('Latest')).toBeInTheDocument(); });
  it('shows the create document dialog', async () => { render(<App config={config} />); await screen.findByText('Project Plan'); fireEvent.click(screen.getAllByRole('button', { name: /Create document/i })[0]); expect(screen.getByRole('dialog')).toHaveTextContent('Create document'); });
});
