import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSelectedUrlsFromCollectorOutput } from './newsPipeline.js';

test('newsPipeline: selection 输出截断时仍可兜底提取完整 URL', () => {
    const text = `{
  "selected_urls": [
    "https://news.bitcoin.com/blackrock-ends-2025-with-771k-bitcoin-as-ceo-larry-fink-eyes-700k-btc/",
    "https:/`;

    const urls = extractSelectedUrlsFromCollectorOutput(text, { maxUrls: 10 });
    assert.ok(urls.length >= 1);
    assert.equal(
        urls[0],
        'https://news.bitcoin.com/blackrock-ends-2025-with-771k-bitcoin-as-ceo-larry-fink-eyes-700k-btc/',
    );
});

