import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/planning/inspiration', () => ({
  generateInspirationItems: vi.fn(),
}));

import { GET } from '@/app/api/cron/refresh-inspiration/route';
import { generateInspirationItems } from '@/lib/planning/inspiration';

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/refresh-inspiration', {
    method: 'GET',
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

describe('GET /api/cron/refresh-inspiration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-secret-123' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header has wrong secret', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 and calls generateInspirationItems with valid secret', async () => {
    (generateInspirationItems as Mock).mockResolvedValue(15);

    const res = await GET(makeRequest('Bearer test-secret-123'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(15);
    expect(generateInspirationItems).toHaveBeenCalledOnce();
  });

  it('returns 500 if generateInspirationItems throws', async () => {
    (generateInspirationItems as Mock).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest('Bearer test-secret-123'));
    expect(res.status).toBe(500);
  });
});
