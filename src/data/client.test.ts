import { describe, expect, it } from 'vitest';
import { DataverseRequestError, Pool, chunk, classifyError, createDataverseClient, extractPagingCookie, nextLinkToRelative, odataString, withPaging, type DataverseApiLike } from './client';

function fakeApi(overrides: Partial<DataverseApiLike> = {}): DataverseApiLike {
    return {
        queryData: async () => ({ value: [] }),
        fetchXmlQuery: async () => ({ value: [] }),
        getEntityMetadata: async () => ({}),
        getAllEntitiesMetadata: async () => ({ value: [] }),
        getEntityRelatedMetadata: async () => ({ value: [] }),
        ...overrides,
    };
}

describe('nextLinkToRelative', () => {
    it('strips the absolute prefix up to the api version', () => {
        expect(nextLinkToRelative('https://org.crm.dynamics.com/api/data/v9.2/workflows?$select=name&$skiptoken=%3Ccookie%3E')).toBe('workflows?$select=name&$skiptoken=%3Ccookie%3E');
        expect(nextLinkToRelative('https://org.crm4.dynamics.com/api/data/v9.0/accounts?$skiptoken=1')).toBe('accounts?$skiptoken=1');
    });
    it('leaves relative links alone', () => {
        expect(nextLinkToRelative('/workflows?$skiptoken=1')).toBe('workflows?$skiptoken=1');
        expect(nextLinkToRelative('workflows?$skiptoken=1')).toBe('workflows?$skiptoken=1');
    });
});

describe('extractPagingCookie / withPaging', () => {
    const annotation = '<cookie pagenumber="2" pagingcookie="%253ccookie%2520page%253d%25221%2522%253e%253c%252fcookie%253e" istracking="False" />';
    it('double-decodes the cookie and reads the page number', () => {
        const parsed = extractPagingCookie(annotation);
        expect(parsed).toEqual({ pageNumber: 2, cookie: '<cookie page="1"></cookie>' });
    });
    it('returns null for missing annotations', () => {
        expect(extractPagingCookie(undefined)).toBeNull();
        expect(extractPagingCookie('<cookie pagenumber="2" />')).toBeNull();
    });
    it('injects page and escaped paging-cookie into the fetch element', () => {
        const xml = '<fetch top="10" page="1"><entity name="account" /></fetch>';
        const paged = withPaging(xml, 2, '<cookie page="1"></cookie>');
        expect(paged).toBe('<fetch top="10" page="2" paging-cookie="&lt;cookie page=&quot;1&quot;&gt;&lt;/cookie&gt;"><entity name="account" /></fetch>');
    });
});

describe('classifyError', () => {
    it('recognises PPTB error message shapes', () => {
        expect(classifyError(new Error('HTTP 429'))).toBe('throttle');
        expect(classifyError(new Error('0x80072322: Number of requests exceeded the limit of 6000'))).toBe('throttle');
        expect(classifyError(new Error('HTTP 403'))).toBe('permission');
        expect(classifyError(new Error('0x80040220: Principal user (Id=...) is missing prvReadSdkMessageProcessingStep privilege'))).toBe('permission');
        expect(classifyError(new Error('HTTP 503'))).toBe('transient');
        expect(classifyError(new Error('Request failed: socket hang up'))).toBe('transient');
        expect(classifyError(new Error("0x80060888: Could not find a property named '_formid_value'"))).toBe('badrequest');
        expect(classifyError(new Error('HTTP 404'))).toBe('notfound');
        expect(classifyError(new Error('something else'))).toBe('error');
    });
});

describe('createDataverseClient', () => {
    it('follows @odata.nextLink and counts requests', async () => {
        const calls: string[] = [];
        const api = fakeApi({
            queryData: async (q) => {
                calls.push(q);
                if (q.includes('$skiptoken')) return { value: [{ id: 3 }] };
                return { value: [{ id: 1 }, { id: 2 }], '@odata.nextLink': 'https://org.crm.dynamics.com/api/data/v9.2/workflows?$select=name&$skiptoken=abc' };
            },
        });
        const client = createDataverseClient(api);
        const rows = await client.query('workflows?$select=name');
        expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
        expect(calls).toEqual(['workflows?$select=name', 'workflows?$select=name&$skiptoken=abc']);
        expect(client.stats.requests).toBe(2);
    });

    it('retries throttled requests with backoff and then succeeds', async () => {
        let attempts = 0;
        const sleeps: number[] = [];
        const api = fakeApi({
            queryData: async () => {
                attempts++;
                if (attempts < 3) throw new Error('HTTP 429');
                return { value: [{ ok: true }] };
            },
        });
        const client = createDataverseClient(api, { backoffMs: 10, sleep: async (ms) => void sleeps.push(ms) });
        const rows = await client.query('accounts');
        expect(rows).toEqual([{ ok: true }]);
        expect(sleeps).toEqual([10, 20]);
        expect(client.stats.retries).toBe(2);
    });

    it('does not retry permission errors and wraps them', async () => {
        const api = fakeApi({ queryData: async () => Promise.reject(new Error('HTTP 403')) });
        const client = createDataverseClient(api, { sleep: async () => undefined });
        await expect(client.query('sdkmessageprocessingsteps')).rejects.toMatchObject({ name: 'DataverseRequestError', kind: 'permission' });
        expect(client.stats.retries).toBe(0);
    });

    it('caches identical queries within a run', async () => {
        let n = 0;
        const api = fakeApi({ queryData: async () => ({ value: [{ n: ++n }] }) });
        const client = createDataverseClient(api);
        await client.query('organizations?$select=name');
        await client.query('organizations?$select=name');
        expect(client.stats.requests).toBe(1);
        expect(client.stats.cacheHits).toBe(1);
    });

    it('pages FetchXML with the paging cookie', async () => {
        const seen: string[] = [];
        const api = fakeApi({
            fetchXmlQuery: async (xml) => {
                seen.push(xml);
                if (/page="2"/.test(xml)) return { value: [{ id: 'b' }], '@Microsoft.Dynamics.CRM.morerecords': false };
                return {
                    value: [{ id: 'a' }],
                    '@Microsoft.Dynamics.CRM.morerecords': true,
                    '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<cookie pagenumber="2" pagingcookie="%253ccookie%2520page%253d%25221%2522%253e" istracking="False" />',
                };
            },
        });
        const client = createDataverseClient(api);
        const rows = await client.fetchXml('<fetch><entity name="account"><attribute name="name" /></entity></fetch>');
        expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
        expect(seen[1]).toContain('page="2"');
        expect(seen[1]).toContain('paging-cookie=');
    });

    it('honours the abort signal', async () => {
        const controller = new AbortController();
        controller.abort();
        const client = createDataverseClient(fakeApi(), { signal: controller.signal });
        await expect(client.query('accounts')).rejects.toBeInstanceOf(DataverseRequestError);
    });
});

describe('Pool', () => {
    it('bounds concurrency', async () => {
        const pool = new Pool(2);
        let active = 0;
        let max = 0;
        const task = () =>
            pool.run(async () => {
                active++;
                max = Math.max(max, active);
                await new Promise((r) => setTimeout(r, 5));
                active--;
            });
        await Promise.all([task(), task(), task(), task(), task()]);
        expect(max).toBe(2);
    });
});

describe('helpers', () => {
    it('chunks arrays', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
    it('escapes OData strings', () => {
        expect(odataString("O'Brien")).toBe("'O''Brien'");
    });
});
