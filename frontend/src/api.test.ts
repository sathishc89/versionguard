import { describe, expect, it, vi } from 'vitest';
import { uploadWithProgress } from './api';

describe('uploadWithProgress', () => {
  it('reports upload progress and resolves on success', async () => {
    const progress: number[] = [];
    class FakeUpload { onprogress: ((event: ProgressEvent) => void) | null = null; }
    class FakeRequest { upload = new FakeUpload(); status = 200; onload: (() => void) | null = null; onerror: (() => void) | null = null; open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent); this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 } as ProgressEvent); this.onload?.(); }); }
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    await uploadWithProgress('https://upload.example', new File(['content'], 'plan.txt', { type: 'text/plain' }), (value) => progress.push(value));
    expect(progress).toEqual([50, 100]);
  });
});
