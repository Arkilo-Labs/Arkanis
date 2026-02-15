import { useMemo } from 'react';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeHref(rawHref) {
    const href = String(rawHref || '').trim();
    if (!/^https?:\/\/\S+$/i.test(href)) return '';
    return href.replace(/"/g, '%22');
}

function renderInlineMarkdown(text) {
    let escaped = escapeHtml(text);

    escaped = escaped.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (match, label, href) => {
            const safeHref = sanitizeHref(href);
            if (!safeHref) return match;
            return `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`;
        },
    );

    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return escaped;
}

function closeList(html, listTypeRef) {
    if (!listTypeRef.current) return;
    html.push(`</${listTypeRef.current}>`);
    listTypeRef.current = '';
}

function closeParagraph(html, paragraphLines) {
    if (!paragraphLines.length) return;
    const content = paragraphLines.map((line) => renderInlineMarkdown(line)).join('<br />');
    html.push(`<p>${content}</p>`);
    paragraphLines.length = 0;
}

function renderMarkdownToHtml(markdown) {
    const lines = String(markdown || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n');

    const html = [];
    const paragraphLines = [];
    const listTypeRef = { current: '' };

    let inCode = false;
    let codeLang = '';
    const codeLines = [];

    for (const line of lines) {
        if (inCode) {
            if (/^```/.test(line)) {
                const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
                html.push(
                    `<pre${langAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
                );
                inCode = false;
                codeLang = '';
                codeLines.length = 0;
                continue;
            }

            codeLines.push(line);
            continue;
        }

        const codeStart = line.match(/^```(.*)$/);
        if (codeStart) {
            closeParagraph(html, paragraphLines);
            closeList(html, listTypeRef);
            inCode = true;
            codeLang = String(codeStart[1] || '').trim();
            continue;
        }

        if (!line.trim()) {
            closeParagraph(html, paragraphLines);
            closeList(html, listTypeRef);
            continue;
        }

        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
            closeParagraph(html, paragraphLines);
            closeList(html, listTypeRef);
            const level = heading[1].length;
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }

        const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
        if (unordered) {
            closeParagraph(html, paragraphLines);
            if (listTypeRef.current !== 'ul') {
                closeList(html, listTypeRef);
                listTypeRef.current = 'ul';
                html.push('<ul>');
            }
            html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
            continue;
        }

        const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
        if (ordered) {
            closeParagraph(html, paragraphLines);
            if (listTypeRef.current !== 'ol') {
                closeList(html, listTypeRef);
                listTypeRef.current = 'ol';
                html.push('<ol>');
            }
            html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
            continue;
        }

        closeList(html, listTypeRef);
        paragraphLines.push(line.trimEnd());
    }

    closeParagraph(html, paragraphLines);
    closeList(html, listTypeRef);

    if (inCode) {
        const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
        html.push(`<pre${langAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }

    return html.join('');
}

export default function MarkdownView({ markdown }) {
    const html = useMemo(() => renderMarkdownToHtml(markdown), [markdown]);
    return <div className="rt-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
