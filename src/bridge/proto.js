import protobuf from 'protobufjs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const PROTO_PATH = join(PROJECT_ROOT, 'proto', 'vlm_bridge.proto');

let rootPromise = null;

async function getRoot() {
    if (!rootPromise) {
        rootPromise = protobuf.load(PROTO_PATH);
    }
    return rootPromise;
}

function toPlainObject(type, msg) {
    return type.toObject(msg, {
        longs: Number,
        defaults: true,
        enums: String,
        oneofs: true,
    });
}

export async function decodeSignalFromSignGit(buffer) {
    const root = await getRoot();
    const type = root.lookupType('vlmbridge.SignalFromSignGit');
    const decoded = type.decode(buffer);
    return toPlainObject(type, decoded);
}

export async function encodeVlmDecision(payload) {
    const root = await getRoot();
    const type = root.lookupType('vlmbridge.VlmDecision');
    const err = type.verify(payload);
    if (err) throw new Error(`VlmDecision 校验失败: ${err}`);
    const msg = type.create(payload);
    return Buffer.from(type.encode(msg).finish());
}

export async function decodeVlmDecision(buffer) {
    const root = await getRoot();
    const type = root.lookupType('vlmbridge.VlmDecision');
    const decoded = type.decode(buffer);
    return toPlainObject(type, decoded);
}
