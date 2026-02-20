/**
 * 对 Buffer/string 做字节数上限截断。
 */
export function limitBytes(data, maxBytes) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '', 'utf-8');
    const totalBytes = buf.byteLength;
    const truncated = totalBytes > maxBytes;
    const sliced = truncated ? buf.subarray(0, maxBytes) : buf;
    return {
        text: sliced.toString('utf-8'),
        bytes: totalBytes,
        truncated,
        maxBytes,
    };
}
