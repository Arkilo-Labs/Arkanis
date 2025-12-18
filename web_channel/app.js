const elConfig = document.getElementById('config');
const elEffective = document.getElementById('effective');
const elConfigKey = document.getElementById('configKey');
const elSignal = document.getElementById('signal');
const elDecision = document.getElementById('decision');
const elMsg = document.getElementById('msg');
const elStatusTimeDisplay = document.getElementById('statusTimeDisplay');
const elPromptSelect = document.getElementById('promptSelect');

const elTabConfig = document.getElementById('tabConfig');
const elTabStatus = document.getElementById('tabStatus');
const elPanelConfig = document.getElementById('panelConfig');
const elPanelStatus = document.getElementById('panelStatus');

const elBtnStatus = document.getElementById('btnStatus');
const elBtnAutoRefresh = document.getElementById('btnAutoRefresh');

const state = {
  lastConfigData: null,
  autoRefreshInterval: null,
  lastRefreshTime: null,
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
  elPanelConfig.style.display = isConfig ? 'block' : 'none';
  elPanelStatus.style.display = isConfig ? 'none' : 'block';
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
    setMsg('还没加载配置，先点"加载"', { isError: true });
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

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function updateStatusTimeDisplay() {
  if (state.lastRefreshTime) {
    const timeStr = formatTime(state.lastRefreshTime);
    const isAuto = elBtnAutoRefresh.dataset.auto === 'true';
    elStatusTimeDisplay.innerHTML = `
      <i class="fas fa-check-circle"></i>
      <span>最后更新: ${timeStr}${isAuto ? ' (自动刷新已开启)' : ''}</span>
    `;
  } else {
    elStatusTimeDisplay.innerHTML = `
      <i class="fas fa-circle-notch"></i>
      <span>点击刷新按钮获取最新数据</span>
    `;
  }
}

async function refreshStatus({ silent = false } = {}) {
  const btn = elBtnStatus;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const data = await apiGet('/api/status');
    state.lastRefreshTime = data.now;
    elSignal.textContent = data.last_signal_json ? JSON.stringify(data.last_signal_json, null, 2) : '(null)';
    elDecision.textContent = data.last_decision_json ? JSON.stringify(data.last_decision_json, null, 2) : '(null)';
    updateStatusTimeDisplay();
    if (!silent) setMsg('状态已刷新');
  } finally {
    btn.disabled = wasDisabled;
    btn.classList.remove('loading');
  }
}

function toggleAutoRefresh() {
  const current = elBtnAutoRefresh.dataset.auto === 'true';
  const next = !current;
  elBtnAutoRefresh.dataset.auto = String(next);

  if (next) {
    elBtnAutoRefresh.innerHTML = '<i class="fas fa-clock"></i> 自动刷新（开）';
    refreshStatus({ silent: true }).catch(() => { });
    state.autoRefreshInterval = setInterval(() => {
      refreshStatus({ silent: true }).catch(() => { });
    }, 5000);
    setMsg('自动刷新已开启（每5秒）');
  } else {
    elBtnAutoRefresh.innerHTML = '<i class="fas fa-clock"></i> 自动刷新（关）';
    if (state.autoRefreshInterval) {
      clearInterval(state.autoRefreshInterval);
      state.autoRefreshInterval = null;
    }
    setMsg('自动刷新已关闭');
  }
}

document.getElementById('btnLoad').addEventListener('click', () => loadConfig().catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnFillEffective').addEventListener('click', () => fillFromEffective());
document.getElementById('btnFormat').addEventListener('click', () => formatEditor());
document.getElementById('btnSave').addEventListener('click', () => saveConfig().catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnClear').addEventListener('click', () => saveConfig({ clear: true }).catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnStatus').addEventListener('click', () => refreshStatus().catch((e) => setMsg(e.message, { isError: true })));
document.getElementById('btnAutoRefresh').addEventListener('click', () => toggleAutoRefresh());

elTabConfig.addEventListener('click', () => setActiveTab('config'));
elTabStatus.addEventListener('click', () => {
  setActiveTab('status');
  if (!state.lastRefreshTime) {
    refreshStatus().catch(() => { });
  }
});

// Prompt Logic
async function initPrompts() {
  try {
    const prompts = await apiGet('/api/prompts');
    elPromptSelect.innerHTML = prompts.map(p => `<option value="${p}">${p}</option>`).join('');
  } catch (e) {
    console.error('Failed to load prompts', e);
  }
}

function updateSelectFromConfig(config) {
  if (!config) return;
  const val = config.vlm?.promptName || 'default';
  elPromptSelect.value = val;
}

elPromptSelect.addEventListener('change', () => {
  const val = elPromptSelect.value;
  const raw = elConfig.value || '{}';
  const parsed = tryParseJson(raw);
  let obj = parsed.ok && parsed.value ? parsed.value : {};

  if (!obj.vlm) obj.vlm = {};
  obj.vlm.promptName = val;

  elConfig.value = formatJsonText(obj);
  setMsg(`已更新 JSON 中的 promptName 为 ${val} (需点击保存)`);
});

// Hook into loadConfig
const originalLoadConfig = loadConfig;
loadConfig = async function (opts) {
  await originalLoadConfig(opts);
  // Try to read from editor value first if available, else from effective
  const raw = elConfig.value;
  const parsed = tryParseJson(raw);
  if (parsed.ok && parsed.value) {
    updateSelectFromConfig(parsed.value);
  } else if (state.lastConfigData?.effectiveConfig) {
    updateSelectFromConfig(state.lastConfigData.effectiveConfig);
  }
};

setActiveTab('config');
initPrompts().then(() => loadConfig().catch(() => { }));
