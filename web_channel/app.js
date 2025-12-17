const elConfig = document.getElementById('config');
const elEffective = document.getElementById('effective');
const elConfigKey = document.getElementById('configKey');
const elSignal = document.getElementById('signal');
const elDecision = document.getElementById('decision');
const elMsg = document.getElementById('msg');
const elStatusNow = document.getElementById('statusNow');

const elTabConfig = document.getElementById('tabConfig');
const elTabStatus = document.getElementById('tabStatus');
const elPanelConfig = document.getElementById('panelConfig');
const elPanelStatus = document.getElementById('panelStatus');

const state = {
  lastConfigData: null,
};

function setMsg(text, { isError = false } = {}) {
  elMsg.textContent = text || '';
  elMsg.classList.toggle('err', Boolean(isError));
  if (!text) return;
  setTimeout(() => {
    if (elMsg.textContent === text) elMsg.textContent = '';
  }, 2500);
}

function formatJsonText(obj) {
  return JSON.stringify(obj, null, 2);
}

function tryParseJson(raw) {
  if (!raw || !raw.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

function setActiveTab(tab) {
  const isConfig = tab === 'config';
  elTabConfig.classList.toggle('active', isConfig);
  elTabStatus.classList.toggle('active', !isConfig);
  elPanelConfig.style.display = isConfig ? '' : 'none';
  elPanelStatus.style.display = isConfig ? 'none' : '';
}

async function loadConfig({ fillWhenEmpty = true } = {}) {
  const data = await apiGet('/api/config');
  state.lastConfigData = data;

  elConfigKey.textContent = `key: ${data.key || '-'}`;
  elEffective.textContent = data.effectiveConfig ? formatJsonText(data.effectiveConfig) : '(null)';

  const raw = data.configRaw || '';
  if (raw.trim()) {
    elConfig.value = raw;
  } else if (fillWhenEmpty && data.effectiveConfig) {
    elConfig.value = formatJsonText(data.effectiveConfig);
  } else {
    elConfig.value = '';
  }

  setMsg('配置已加载');
}

async function saveConfig({ clear = false } = {}) {
  const raw = clear ? '' : elConfig.value || '';

  const parsed = tryParseJson(raw);
  if (!parsed.ok) {
    setMsg(`JSON 解析失败：${parsed.error.message}`, { isError: true });
    return;
  }

  const r = await apiPost('/api/config', { configRaw: raw });
  if (r.cleared) {
    setMsg('已清空（删除 Redis key）');
  } else {
    setMsg('配置已保存');
  }
  await loadConfig({ fillWhenEmpty: true });
}

function fillFromEffective() {
  const effective = state.lastConfigData?.effectiveConfig;
  if (!effective) {
    setMsg('还没加载配置，先点“加载”', { isError: true });
    return;
  }
  elConfig.value = formatJsonText(effective);
  setMsg('已填充当前生效配置');
}

function formatEditor() {
  const raw = elConfig.value || '';
  const parsed = tryParseJson(raw);
  if (!parsed.ok) {
    setMsg(`JSON 解析失败：${parsed.error.message}`, { isError: true });
    return;
  }
  if (parsed.value === null) {
    setMsg('空配置无需格式化');
    return;
  }
  elConfig.value = formatJsonText(parsed.value);
  setMsg('已格式化');
}

async function refreshStatus() {
  const data = await apiGet('/api/status');
  elStatusNow.textContent = data.now || '-';
  elSignal.textContent = data.last_signal_json ? JSON.stringify(data.last_signal_json, null, 2) : '(null)';
  elDecision.textContent = data.last_decision_json ? JSON.stringify(data.last_decision_json, null, 2) : '(null)';
  setMsg('状态已刷新');
}

document.getElementById('btnLoad').addEventListener('click', () => loadConfig().catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnFillEffective').addEventListener('click', () => fillFromEffective());
document.getElementById('btnFormat').addEventListener('click', () => formatEditor());
document.getElementById('btnSave').addEventListener('click', () => saveConfig().catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnClear').addEventListener('click', () => saveConfig({ clear: true }).catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnStatus').addEventListener('click', () => refreshStatus().catch((e) => setMsg(e.message, { isError: true })));

elTabConfig.addEventListener('click', () => setActiveTab('config'));
elTabStatus.addEventListener('click', () => {
  setActiveTab('status');
  refreshStatus().catch(() => {});
});

setActiveTab('config');
loadConfig().catch(() => {});
refreshStatus().catch(() => {});
