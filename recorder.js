const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const logger = require('./utils/logger');

const BASE_URL = 'https://testing.winwinbot.com';
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const TMP_DIR = path.join(__dirname, '.tmp');
const AUTH_STATE_PATH = path.join(TMP_DIR, 'recording-auth-state.json');
const AUTH_STATE_TTL_MS = 6 * 60 * 60 * 1000;

let state = {
  running: false,
  name: null,
  pid: null,
  startedAt: null,
  rawPath: null,
  outputPath: null,
  error: null,
};
let recorderChild = null;

function sanitizeName(name) {
  if (typeof name !== 'string') return '';

  const cleaned = name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');

  return cleaned;
}

async function ensureDirs() {
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });
}

async function loadConfig() {
  const raw = await fs.readFile(path.join(__dirname, 'config.json'), 'utf-8');
  return JSON.parse(raw);
}

async function saveConfig(config) {
  await fs.writeFile(path.join(__dirname, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function getDefaultStartUrl(config) {
  const chatId = config.chatId;
  if (chatId && !Number.isNaN(Number(chatId))) {
    return `${BASE_URL}/ru/chat/${chatId}/automation/automations`;
  }
  return BASE_URL;
}

function normalizeStartUrl(input, fallback) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) {
      throw new Error('Недопустимый протокол URL.');
    }
    return url.toString();
  } catch (_) {
    throw new Error('Некорректный URL страницы после логина.');
  }
}

function makeAutoScenarioName() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Сценарий ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

async function autoLoginAndSaveStorage(startUrl) {
  const config = await loadConfig();
  const email = process.env.WINWINBOT_EMAIL || config.email;
  const password = process.env.WINWINBOT_PASSWORD || config.password;

  if (!email || !password) {
    throw new Error('Не заданы email/password для автологина. Укажите в config.json или через env.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: 15000 });
    await page.locator('input[type="email"]').first().fill(email);
    await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 });
    await page.locator('input[type="password"]').first().fill(password);
    await page.waitForSelector('button[type="submit"]', { state: 'visible', timeout: 15000 });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await context.storageState({ path: AUTH_STATE_PATH });
    logger.info('Автологин для записи выполнен, storage state сохранен.');

    return startUrl;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function hasFreshAuthState() {
  try {
    const stat = await fs.stat(AUTH_STATE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs >= 0 && ageMs < AUTH_STATE_TTL_MS;
  } catch (_) {
    return false;
  }
}

async function getStartUrlWithOptionalAutoLogin(useAutoLogin) {
  const config = await loadConfig();
  const configuredStartUrl = normalizeStartUrl(config.recordingStartUrl, getDefaultStartUrl(config));

  if (!useAutoLogin) {
    return configuredStartUrl;
  }

  if (await hasFreshAuthState()) {
    logger.info('Использую кешированную сессию автологина для записи.');
    return configuredStartUrl;
  }

  logger.info('Кеш сессии отсутствует или устарел, выполняю автологин.');
  await autoLoginAndSaveStorage(configuredStartUrl);
  return configuredStartUrl;
}

function extractActionsFromCodegen(rawCode) {
  const lines = rawCode.split(/\r?\n/);

  let startIdx = lines.findIndex((line) => line.includes('const page = await context.newPage();'));
  if (startIdx >= 0) {
    startIdx += 1;
  } else {
    startIdx = lines.findIndex((line) => line.includes('await page.'));
  }

  if (startIdx < 0) {
    return [];
  }

  let endIdx = lines.findIndex((line, idx) => idx > startIdx && line.includes('await context.close();'));
  if (endIdx < 0) {
    endIdx = lines.findIndex((line, idx) => idx > startIdx && line.includes('await browser.close();'));
  }
  if (endIdx < 0) {
    endIdx = lines.findIndex((line, idx) => idx > startIdx && line.includes('})();'));
  }
  if (endIdx < 0) {
    endIdx = lines.length;
  }

  const actions = lines.slice(startIdx, endIdx).map((line) => line.replace(/^\s{2}/, '')).filter((line) => line.trim().length > 0);

  return actions;
}

function toModuleScript(name, actions) {
  const header = [
    `// Scenario: ${name}`,
    '// Generated from Playwright codegen. Edit if needed.',
    'module.exports = async (page) => {',
    '  page.setDefaultTimeout(12000);',
  ];

  const body = actions.length
    ? actions.map((line) => `  ${line}`)
    : ['  // No actions were captured.'];

  const footer = ['};', ''];

  return [...header, ...body, ...footer].join('\n');
}

async function convertRawToScript(name, rawPath, outputPath) {
  const raw = await fs.readFile(rawPath, 'utf-8');
  const actions = extractActionsFromCodegen(raw);
  if (actions.length === 0) {
    throw new Error('Codegen не вернул действий. Повторите запись и закройте окно codegen после действий.');
  }

  const moduleCode = toModuleScript(name, actions);
  await fs.writeFile(outputPath, moduleCode, 'utf-8');
}

async function listScripts() {
  await ensureDirs();
  const entries = await fs.readdir(SCRIPTS_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name);

  const scripts = await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(SCRIPTS_DIR, file);
      const stat = await fs.stat(fullPath);
      return {
        name: file.replace(/\.js$/, ''),
        file,
        updatedAt: stat.mtime.toISOString(),
      };
    })
  );

  scripts.sort((a, b) => a.name.localeCompare(b.name));
  return scripts;
}

async function deleteScript(name) {
  const safeName = sanitizeName(name);
  if (!safeName) {
    throw new Error('Некорректное имя сценария.');
  }
  const target = path.join(SCRIPTS_DIR, `${safeName}.js`);
  await fs.unlink(target);
  logger.info(`Сценарий удален: ${safeName}`);
  return { name: safeName };
}

async function getScriptContent(name) {
  await ensureDirs();
  const safeName = sanitizeName(name);
  if (!safeName) {
    throw new Error('Некорректное имя сценария.');
  }
  const target = path.join(SCRIPTS_DIR, `${safeName}.js`);
  const content = await fs.readFile(target, 'utf-8');
  return { name: safeName, content };
}

async function updateScriptContent(name, content) {
  await ensureDirs();
  const safeName = sanitizeName(name);
  if (!safeName) {
    throw new Error('Некорректное имя сценария.');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Пустой код сценария сохранять нельзя.');
  }
  const target = path.join(SCRIPTS_DIR, `${safeName}.js`);
  await fs.writeFile(target, content, 'utf-8');
  logger.info(`Сценарий обновлен: ${safeName}`);
  return { name: safeName };
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function resetRunningStateIfStale() {
  if (state.running && !isProcessAlive(state.pid)) {
    logger.warn('Обнаружена зависшая запись без процесса. Сбрасываю состояние.');
    state.running = false;
    state.pid = null;
  }
}

async function startRecording(inputName, options = {}) {
  resetRunningStateIfStale();
  if (state.running) {
    throw new Error(`Уже идет запись: ${state.name}`);
  }

  await ensureDirs();

  const requestedName = typeof inputName === 'string' ? inputName : '';
  const rawName = requestedName.trim() ? requestedName : makeAutoScenarioName();
  const name = sanitizeName(rawName);
  if (!name) {
    throw new Error('Некорректное имя сценария. Можно использовать русский текст, цифры, пробелы, "_" и "-".');
  }
  const rawPath = path.join(TMP_DIR, `${name}.raw.codegen.js`);
  const outputPath = path.join(SCRIPTS_DIR, `${name}.js`);
  await fs.rm(rawPath, { force: true }).catch(() => {});
  const useAutoLogin = options.autoLogin !== false;
  const startUrl = await getStartUrlWithOptionalAutoLogin(useAutoLogin);
  const codegenArgs = ['codegen', startUrl, '--target', 'javascript', '--output', rawPath];
  if (useAutoLogin) {
    codegenArgs.push('--load-storage', AUTH_STATE_PATH);
  }

  const playwrightBin = path.join(__dirname, 'node_modules', '.bin', 'playwright');
  const child = spawn(
    playwrightBin,
    codegenArgs,
    {
      cwd: __dirname,
      stdio: 'pipe',
      shell: false,
      detached: true,
    }
  );
  recorderChild = child;

  state = {
    running: true,
    name,
    pid: child.pid || null,
    startedAt: new Date().toISOString(),
    rawPath,
    outputPath,
    error: null,
  };

  logger.info(`Запущена запись сценария: ${name}`);

  child.stdout.on('data', (buf) => {
    const msg = String(buf).trim();
    if (msg) {
      logger.info(`codegen: ${msg}`);
    }
  });

  child.stderr.on('data', (buf) => {
    const msg = String(buf).trim();
    if (msg) {
      logger.warn(`codegen: ${msg}`);
    }
  });

  child.on('close', async (code, signal) => {
    logger.info(`Codegen завершен (code=${code}, signal=${signal || 'none'})`);

    try {
      if (code !== 0 && signal !== 'SIGINT') {
        logger.warn(`Codegen завершился нештатно (code=${code}), пробую сохранить то, что уже записано.`);
      }
      await convertRawToScript(name, rawPath, outputPath);
      logger.info(`Сценарий сохранен: ${outputPath}`);
      state.error = null;
    } catch (err) {
      if (code !== 0 && signal !== 'SIGINT') {
        state.error = `Codegen завершился с ошибкой (code=${code}, signal=${signal || 'none'}): ${err.message}`;
      } else {
        state.error = err.message;
      }
      logger.error(`Ошибка конвертации сценария: ${err.message}`);
    } finally {
      state.running = false;
      state.pid = null;
      recorderChild = null;
    }
  });

  child.on('error', (err) => {
    state.error = err.message;
    state.running = false;
    state.pid = null;
    recorderChild = null;
    logger.error(`Ошибка запуска codegen: ${err.message}`);
  });

  return {
    name,
    pid: state.pid,
    message: useAutoLogin
      ? 'Открылся Playwright codegen с автологином. Выполните шаги вручную и закройте окно codegen.'
      : 'Открылся Playwright codegen без автологина. Выполните логин и шаги вручную, затем закройте окно codegen.',
  };
}

async function getRecordingSettings() {
  const config = await loadConfig();
  const startUrl = normalizeStartUrl(config.recordingStartUrl, getDefaultStartUrl(config));
  const defaultAutoLogin = typeof config.defaultAutoLogin === 'boolean' ? config.defaultAutoLogin : false;

  return {
    recordingStartUrl: startUrl,
    defaultAutoLogin,
    email: typeof config.email === 'string' ? config.email : '',
    password: typeof config.password === 'string' ? config.password : '',
  };
}

async function updateRecordingSettings(input) {
  const config = await loadConfig();
  const next = { ...config };

  if (Object.prototype.hasOwnProperty.call(input, 'recordingStartUrl')) {
    next.recordingStartUrl = normalizeStartUrl(input.recordingStartUrl, getDefaultStartUrl(config));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'defaultAutoLogin')) {
    next.defaultAutoLogin = Boolean(input.defaultAutoLogin);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'email')) {
    if (typeof input.email !== 'string' || !input.email.trim()) {
      throw new Error('Email не может быть пустым.');
    }
    next.email = input.email.trim();
  }

  if (Object.prototype.hasOwnProperty.call(input, 'password')) {
    if (typeof input.password !== 'string' || !input.password) {
      throw new Error('Пароль не может быть пустым.');
    }
    next.password = input.password;
  }

  await saveConfig(next);
  return getRecordingSettings();
}

async function stopRecording() {
  resetRunningStateIfStale();
  if (!state.running || !state.pid) {
    throw new Error('Сейчас нет активной записи.');
  }

  try {
    process.kill(-state.pid, 'SIGINT');
  } catch (_) {
    if (recorderChild && !recorderChild.killed) {
      recorderChild.kill('SIGINT');
    } else {
      process.kill(state.pid, 'SIGINT');
    }
  }
  logger.info(`Запрошена остановка записи сценария: ${state.name}`);
  return { name: state.name, stopping: true };
}

function getRecordingStatus() {
  return { ...state };
}

module.exports = {
  listScripts,
  deleteScript,
  getScriptContent,
  updateScriptContent,
  getRecordingSettings,
  updateRecordingSettings,
  startRecording,
  stopRecording,
  getRecordingStatus,
};
