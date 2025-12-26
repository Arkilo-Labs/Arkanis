function extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    const candidate = raw.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function safeTruncate(text, maxChars) {
    const s = String(text || '');
    if (!maxChars || s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

function canonicalUrl(u) {
    try {
        const url = new URL(u);
        url.hash = '';
        const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
        for (const k of drop) url.searchParams.delete(k);
        return url.toString();
    } catch {
        return String(u || '').trim();
    }
}

async function mapWithConcurrency(items, limit, fn) {
    const concurrency = Math.max(1, Number(limit) || 1);
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        for (; ;) {
            const i = nextIndex++;
            if (i >= items.length) return;
            results[i] = await fn(items[i], i);
        }
    });

    await Promise.all(workers);
    return results;
}

function formatSearchResultsForModel({ queries, resultsByQuery, maxItems = 40 } = {}) {
    const lines = [];
    let idx = 1;
    for (let qi = 0; qi < queries.length; qi++) {
        const q = queries[qi];
        const results = resultsByQuery[qi] ?? [];
        lines.push(`## Query ${qi + 1}: ${q}`);
        for (const r of results) {
            if (idx > maxItems) break;
            lines.push(
                [
                    `- [${idx}] ${r.title || '(no title)'}`,
                    `  - url: ${r.url}`,
                    r.publishedDate ? `  - publishedDate: ${r.publishedDate}` : null,
                    r.engine ? `  - engine: ${r.engine}` : null,
                    r.content ? `  - snippet: ${safeTruncate(r.content, 260)}` : null,
                ]
                    .filter(Boolean)
                    .join('\n'),
            );
            idx++;
        }
        if (idx > maxItems) break;
    }
    return lines.join('\n');
}

function formatDocsForModel({ docs, maxTotalChars } = {}) {
    const parts = [];
    let used = 0;
    for (const d of docs) {
        const head = `## 来源：${d.url}\n`;
        const body = d.markdown || '';
        const remaining = Math.max(0, (maxTotalChars ?? 0) - used - head.length);
        if (remaining <= 0) break;
        const clippedBody = remaining ? body.slice(0, remaining) : '';
        parts.push(`${head}${clippedBody}`);
        used += head.length + clippedBody.length;
    }
    return parts.join('\n\n');
}

export async function runNewsPipeline({
    collectorAgent,
    searxngClient,
    firecrawlClient,
    symbol,
    assetClass,
    settings,
    logger,
}) {
    if (!collectorAgent) throw new Error('news_pipeline 需要 collectorAgent');
    if (!searxngClient) throw new Error('news_pipeline 需要 searxngClient');
    if (!firecrawlClient) throw new Error('news_pipeline 需要 firecrawlClient');

    const searchCfg = settings?.search ?? {};
    const fetchCfg = settings?.fetch ?? {};

    const recencyHours = Number(searchCfg.recency_hours ?? 24);
    const queriesMax = Number(searchCfg.queries_max ?? 4);
    const resultsPerQuery = Number(searchCfg.results_per_query ?? 10);
    const pagesPerQuery = Number(searchCfg.pages_per_query ?? 1);
    const language = String(searchCfg.language || 'zh-CN');

    const maxUrls = Number(fetchCfg.max_urls ?? 6);
    const concurrency = Number(fetchCfg.concurrency ?? 3);
    const maxMdPerUrl = Number(fetchCfg.max_markdown_chars_per_url ?? 7000);
    const maxTotalMd = Number(fetchCfg.max_total_markdown_chars ?? 22000);

    logger?.info?.('新闻管线：生成搜索查询');
    const queryPlanText = await collectorAgent.speak({
        contextText: [
            `# 任务`,
            `为这次交易分析收集「最近 ${recencyHours} 小时」内可能影响价格波动的新闻/公告/宏观事件。`,
            ``,
            `# 输入`,
            `- symbol: ${symbol}`,
            assetClass ? `- assetClass: ${assetClass}` : `- assetClass: (auto/unknown)`,
            ``,
            `# 输出（必须是严格 JSON）`,
            `你只能输出一个 JSON 对象：`,
            `{`,
            `  "queries": ["..."],`,
            `  "language": "${language}",`,
            `  "recency_hours": ${recencyHours}`,
            `}`,
            ``,
            `# 查询生成策略`,
            `- 覆盖多维度：标的本身、上下游产业链、宏观政策、监管动态、市场情绪`,
            `- 混合语言：中文+英文各一组（如 "比特币 ETF" + "Bitcoin ETF"）`,
            `- 分时效：近12h紧急新闻 + 近24h背景分析`,
            `- 包含负面筛选：避开广告、招聘、论坛帖等低质内容`,
            ``,
            `# 约束`,
            `- queries 数量不超过 ${queriesMax}，每条尽量短但覆盖面广`,
            `- 不要输出解释性文字，不要加 Markdown。`,
        ].join('\n'),
        imagePaths: [],
        toolResults: [],
        callOptions: { retries: 1, timeoutMs: 90000 },
    });

    const queryPlan = extractJsonObject(queryPlanText);
    const queries = Array.isArray(queryPlan?.queries) ? queryPlan.queries.map((s) => String(s || '').trim()).filter(Boolean) : [];
    if (!queries.length) {
        throw new Error(`新闻管线：collector 未返回 queries（原始输出：${safeTruncate(queryPlanText, 300)}）`);
    }
    const clippedQueries = queries.slice(0, queriesMax);

    logger?.info?.(`新闻管线：SearXNG 搜索（queries=${clippedQueries.length}, pages=${pagesPerQuery}）`);
    const resultsByQuery = [];
    for (const q of clippedQueries) {
        const res = await searxngClient.searchMultiPage({
            query: q,
            language,
            categories: 'general',
            recencyHours,
            resultsPerPage: resultsPerQuery,
            pages: pagesPerQuery,
        });
        resultsByQuery.push(res);
    }

    logger?.info?.('新闻管线：选择 URL');
    const selectionText = await collectorAgent.speak({
        contextText: [
            `# 任务`,
            `从下面的 SearXNG 结果里挑选要抓取的新闻 URL，用于后续 Firecrawl 抓取原文。`,
            ``,
            `# URL 选择优先级`,
            `1. 权威财经媒体 > 行业垂直媒体 > 社交平台`,
            `2. 官方公告 > 深度分析 > 快讯`,
            `3. 首发来源 > 转载`,
            `4. 避开：纯视频页、登录墙、404风险页、论坛帖`,
            ``,
            `# 要求`,
            `- 只选择与本次分析最相关的 ${maxUrls} 条以内`,
            `- 去重：同一事件尽量选 1 个最权威/最原始来源`,
            `- 优先选择能直接呈现信息的页面`,
            ``,
            `# 输入：SearXNG 结果（共 ${resultsByQuery.flat().length} 条）`,
            formatSearchResultsForModel({ queries: clippedQueries, resultsByQuery, maxItems: 120 }),
            ``,
            `# 输出（必须是严格 JSON）`,
            `你只能输出一个 JSON 对象：`,
            `{`,
            `  "selected_urls": ["https://..."],`,
            `  "why": { "https://...": "一句话理由" }`,
            `}`,
            ``,
            `# 约束`,
            `- selected_urls 长度不超过 ${maxUrls}`,
            `- why 只对 selected_urls 里的 URL 给理由`,
            `- 不要输出解释性文字，不要加 Markdown。`,
        ].join('\n'),
        imagePaths: [],
        toolResults: [],
        callOptions: { retries: 1, timeoutMs: 120000 },
    });

    const selection = extractJsonObject(selectionText);
    const rawUrls = Array.isArray(selection?.selected_urls) ? selection.selected_urls : [];
    const selectedUrls = rawUrls.map((u) => canonicalUrl(String(u || '').trim())).filter(Boolean).slice(0, maxUrls);
    if (!selectedUrls.length) {
        throw new Error(`新闻管线：collector 未返回 selected_urls（原始输出：${safeTruncate(selectionText, 300)}）`);
    }

    logger?.info?.(`新闻管线：Firecrawl 抓取（urls=${selectedUrls.length}）`);
    const scrapeResults = await mapWithConcurrency(selectedUrls, concurrency, async (url) => {
        try {
            const { markdown, metadata } = await firecrawlClient.scrapeToMarkdown({ url });
            return {
                url,
                ok: true,
                markdown: safeTruncate(markdown, maxMdPerUrl),
                title: metadata?.title ?? null,
                statusCode: metadata?.statusCode ?? null,
            };
        } catch (e) {
            return { url, ok: false, error: String(e.message || e) };
        }
    });

    const okDocs = scrapeResults.filter((r) => r.ok && r.markdown);
    const failedDocs = scrapeResults.filter((r) => !r.ok);
    if (!okDocs.length) {
        const err = failedDocs.length ? `；失败示例：${safeTruncate(failedDocs[0].error, 160)}` : '';
        throw new Error(`新闻管线：Firecrawl 无可用内容${err}`);
    }

    const docsForModel = formatDocsForModel({ docs: okDocs, maxTotalChars: maxTotalMd });
    logger?.info?.('新闻管线：生成新闻简报');
    const briefingText = await collectorAgent.speak({
        contextText: [
            `# 任务`,
            `基于下面的网页原文（Markdown），为「${symbol}」生成「足够长、可直接被后续 agent 复用」的新闻整合稿。`,
            ``,
            `# 强制要求`,
            `- 只基于提供的原文，不要臆造来源/时间/数据`,
            `- 必须输出「引用列表」，每条引用包含 URL，并在正文要点/卡片里用 [1][2] 这样的编号引用`,
            `- 只关注未来 24h 可能影响方向/波动的变量`,
            `- 必须把每条新闻“讲清楚”：发生了什么、为何重要、潜在交易影响、关键不确定性`,
            ``,
            `# 输出格式（必须是 Markdown）`,
            `你必须按以下结构输出：`,
            `## 新闻主线（5~10条）`,
            `- 用一句话概括事件 + 影响方向/波动 + 关键条件 ... [1]`,
            ``,
            `## 逐条新闻卡片（按重要性排序，至少 8 条）`,
            `### [1] <标题或事件名>`,
            `- 来源/时间：...`,
            `- 核心事实（3~6条）：...`,
            `- 交易影响（多/空/双向/不确定）：...`,
            `- 关键不确定性/需要验证：...`,
            `- 原文关键句（可选，1~3条短摘录）："...""`,
            ``,
            `（重复以上卡片结构）`,
            ``,
            `## 情绪标签`,
            `Fear / Neutral / Greed（并给 1 句话理由）`,
            ``,
            `## 24h 风险点（2~5个）`,
            `- ... [2]`,
            ``,
            `## 引用`,
            `1. <url>（可附标题）`,
            `2. <url>（可附标题）`,
            ``,
            `# 输入：网页原文（Markdown，可能被截断）`,
            docsForModel,
        ].join('\n'),
        imagePaths: [],
        toolResults: [],
        callOptions: { retries: 1, timeoutMs: 150000 },
    });

    return {
        briefingMarkdown: String(briefingText || '').trim(),
        queries: clippedQueries,
        selectedUrls,
        scrapeResults,
    };
}
