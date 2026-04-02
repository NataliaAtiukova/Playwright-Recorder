const scriptsListEl = document.getElementById('scriptsList');
const logBox = document.getElementById('logBox');
const recordStatusEl = document.getElementById('recordStatus');
const recordNameEl = document.getElementById('recordName');
const autoLoginToggleEl = document.getElementById('autoLoginToggle');
const startUrlInputEl = document.getElementById('startUrlInput');
const emailInputEl = document.getElementById('emailInput');
const passwordInputEl = document.getElementById('passwordInput');
const defaultAutoLoginToggleEl = document.getElementById('defaultAutoLoginToggle');
const saveSettingsBtnEl = document.getElementById('saveSettingsBtn');
const scriptEditorEl = document.getElementById('scriptEditor');
const saveScriptBtn = document.getElementById('saveScriptBtn');
const editorHintEl = document.getElementById('editorHint');
const toastHostEl = document.getElementById('toastHost');

let wasRecording = false;
let selectedScript = null;
let backendLogCursor = 0;

function notify(message, type = 'ok') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastHostEl.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logBox.textContent += `${line}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

async function api(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (_) {
    throw new Error('Локальный сервер недоступен. Перезапустите node index.js');
  }

  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error(`Некорректный ответ сервера (HTTP ${res.status})`);
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

async function openScriptInEditor(name) {
  const data = await api(`/api/scripts/${encodeURIComponent(name)}`);
  selectedScript = data.name;
  scriptEditorEl.disabled = false;
  scriptEditorEl.value = data.content;
  editorHintEl.textContent = `Редактируется: ${data.name}.js`;
  log(`Открыт код сценария: ${data.name}`);
  notify(`Открыт сценарий: ${data.name}`, 'ok');
}

function renderScripts(scripts) {
  if (!scripts.length) {
    scriptsListEl.innerHTML = '<p class="muted">Сценариев пока нет.</p>';
    return;
  }

  scriptsListEl.innerHTML = scripts
    .map(
      (script) => `
      <div class="item">
        <div class="item-left">
          <input type="checkbox" data-name="${script.name}" />
          <div>
            <div><strong>${script.name}</strong></div>
            <div class="muted">${script.file} · ${new Date(script.updatedAt).toLocaleString()}</div>
          </div>
        </div>
        <div class="row">
          <button class="ghost" data-open="${script.name}">Открыть код</button>
          <button class="danger" data-delete="${script.name}">🗑 Удалить</button>
        </div>
      </div>
    `
    )
    .join('');

  document.querySelectorAll('button[data-open]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-open');
      try {
        await openScriptInEditor(name);
      } catch (err) {
        log(`Ошибка открытия кода: ${err.message}`);
        notify(`Ошибка открытия: ${err.message}`, 'err');
      }
    });
  });

  document.querySelectorAll('button[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-delete');
      if (!confirm(`Удалить сценарий ${name}?`)) return;

      try {
        await api(`/api/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' });
        log(`Удален сценарий: ${name}`);
        notify(`Сценарий удален: ${name}`, 'ok');

        if (selectedScript === name) {
          selectedScript = null;
          scriptEditorEl.value = '';
          scriptEditorEl.disabled = true;
          editorHintEl.textContent = 'Выберите сценарий и нажмите "Открыть код".';
        }

        await refreshScripts();
      } catch (err) {
        log(`Ошибка удаления: ${err.message}`);
        notify(`Ошибка удаления: ${err.message}`, 'err');
      }
    });
  });
}

async function refreshScripts() {
  const data = await api('/api/scripts');
  renderScripts(data.scripts);
}

async function loadSettings() {
  const data = await api('/api/settings');
  startUrlInputEl.value = data.settings.recordingStartUrl || '';
  defaultAutoLoginToggleEl.checked = Boolean(data.settings.defaultAutoLogin);
  autoLoginToggleEl.checked = Boolean(data.settings.defaultAutoLogin);
  emailInputEl.value = data.settings.email || '';
  passwordInputEl.value = data.settings.password || '';
}

async function pullBackendLogs() {
  try {
    const data = await api(`/api/logs?since=${backendLogCursor}`);
    for (const item of data.logs) {
      log(item.line);
    }
    backendLogCursor = data.lastId || backendLogCursor;
  } catch (_) {
    // ignore transient poll issues
  }
}

async function refreshRecordStatus() {
  try {
    const data = await api('/api/record/status');
    const status = data.status;
    if (status.running) {
      recordStatusEl.textContent = `Запись активна: ${status.name} (pid=${status.pid || 'n/a'})`;
      wasRecording = true;
    } else if (status.error) {
      recordStatusEl.textContent = `Последняя ошибка записи: ${status.error}`;
      if (wasRecording) {
        wasRecording = false;
        refreshScripts().catch(() => {});
      }
    } else {
      recordStatusEl.textContent = 'Запись не активна.';
      if (wasRecording) {
        wasRecording = false;
        log('Запись завершена.');
        notify('Запись завершена', 'ok');
        refreshScripts().catch(() => {});
      }
    }
  } catch (err) {
    recordStatusEl.textContent = `Ошибка статуса: ${err.message}`;
  }
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try {
    await refreshScripts();
    log('Список сценариев обновлен.');
    notify('Список сценариев обновлен', 'ok');
  } catch (err) {
    log(`Ошибка обновления: ${err.message}`);
    notify(`Ошибка обновления: ${err.message}`, 'err');
  }
});

document.getElementById('startRecordBtn').addEventListener('click', async () => {
  const startBtn = document.getElementById('startRecordBtn');
  const name = recordNameEl.value.trim();

  try {
    startBtn.disabled = true;
    startBtn.textContent = 'Подготовка...';
    const autoLogin = Boolean(autoLoginToggleEl.checked);
    if (autoLogin) {
      log('Подготовка записи: проверка/обновление автологина...');
    } else {
      log('Подготовка записи без автологина...');
    }
    const data = await api('/api/record/start', {
      method: 'POST',
      body: JSON.stringify({ name, autoLogin }),
    });
    log(`Запись запущена: ${data.name}. Выполните шаги и закройте окно codegen.`);
    notify(`Запись запущена: ${data.name}`, 'ok');
    await refreshRecordStatus();
  } catch (err) {
    log(`Ошибка запуска записи: ${err.message}`);
    notify(`Ошибка запуска записи: ${err.message}`, 'err');
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = '➕ Записать сценарий';
  }
});

saveSettingsBtnEl.addEventListener('click', async () => {
  try {
    const data = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        recordingStartUrl: startUrlInputEl.value,
        defaultAutoLogin: Boolean(defaultAutoLoginToggleEl.checked),
        email: emailInputEl.value,
        password: passwordInputEl.value,
      }),
    });
    startUrlInputEl.value = data.settings.recordingStartUrl || '';
    defaultAutoLoginToggleEl.checked = Boolean(data.settings.defaultAutoLogin);
    autoLoginToggleEl.checked = Boolean(data.settings.defaultAutoLogin);
    emailInputEl.value = data.settings.email || '';
    passwordInputEl.value = data.settings.password || '';
    log('Настройки записи сохранены.');
    notify('Настройки записи сохранены', 'ok');
  } catch (err) {
    log(`Ошибка сохранения настроек: ${err.message}`);
    notify(`Ошибка сохранения настроек: ${err.message}`, 'err');
  }
});

document.getElementById('stopRecordBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/record/stop', { method: 'POST' });
    log(`Остановка записи отправлена: ${data.name}`);
    notify(`Остановка записи: ${data.name}`, 'ok');
    await refreshRecordStatus();
    setTimeout(refreshScripts, 1500);
  } catch (err) {
    log(`Ошибка остановки записи: ${err.message}`);
    notify(`Ошибка остановки: ${err.message}`, 'err');
  }
});

document.getElementById('runSelectedBtn').addEventListener('click', async () => {
  const checked = [...document.querySelectorAll('input[type="checkbox"][data-name]:checked')];
  const names = checked.map((el) => el.getAttribute('data-name'));

  if (!names.length) {
    notify('Выберите минимум один сценарий.', 'err');
    return;
  }

  log(`Запуск: ${names.join(', ')}`);

  try {
    const data = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({ names }),
    });

    for (const item of data.summary) {
      if (item.ok) {
        log(`OK: ${item.name}`);
      } else {
        log(`FAIL: ${item.name} -> ${item.error}`);
      }
    }
    notify('Запуск сценариев завершен', 'ok');
  } catch (err) {
    log(`Ошибка запуска: ${err.message}`);
    notify(`Ошибка запуска: ${err.message}`, 'err');
  }
});

saveScriptBtn.addEventListener('click', async () => {
  if (!selectedScript) {
    notify('Сначала откройте сценарий.', 'err');
    return;
  }

  try {
    await api(`/api/scripts/${encodeURIComponent(selectedScript)}`, {
      method: 'PUT',
      body: JSON.stringify({ content: scriptEditorEl.value }),
    });
    log(`Сценарий сохранен: ${selectedScript}`);
    notify(`Сценарий сохранен: ${selectedScript}`, 'ok');
    await refreshScripts();
  } catch (err) {
    log(`Ошибка сохранения: ${err.message}`);
    notify(`Ошибка сохранения: ${err.message}`, 'err');
  }
});

setInterval(() => {
  refreshRecordStatus().catch(() => {});
}, 2000);

setInterval(() => {
  pullBackendLogs().catch(() => {});
}, 1500);

(async function init() {
  try {
    await loadSettings();
    await refreshScripts();
    await refreshRecordStatus();
    await pullBackendLogs();
    log('UI готов.');
    notify('UI готов', 'ok');
  } catch (err) {
    log(`Ошибка инициализации: ${err.message}`);
    notify(`Ошибка инициализации: ${err.message}`, 'err');
  }
})();
