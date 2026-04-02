const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');
const logger = require('./utils/logger');

const BASE_URL = 'https://testing.winwinbot.com';
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function pause(page, ms) {
  return page.waitForTimeout(ms);
}

async function safePause(page, ms) {
  if (!page || page.isClosed()) {
    return;
  }

  try {
    await pause(page, ms);
  } catch (err) {
    logger.warn(`Пауза пропущена: ${err.message}`);
  }
}

async function loadConfig() {
  const raw = await fs.readFile(path.join(__dirname, 'config.json'), 'utf-8');
  return JSON.parse(raw);
}

async function login(page, email, password) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000, state: 'visible' });
  await page.locator('input[type="email"]').first().fill(email);
  await pause(page, 300);

  await page.waitForSelector('input[type="password"]', { timeout: 15000, state: 'visible' });
  await page.locator('input[type="password"]').first().fill(password);
  await pause(page, 300);

  await page.waitForSelector('button[type="submit"]', { timeout: 15000, state: 'visible' });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await pause(page, 700);

  logger.info('Логин выполнен.');
}

function resolveScriptPath(name) {
  if (typeof name !== 'string') {
    throw new Error('Недопустимое имя сценария.');
  }
  const safeName = name.trim();
  if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName.includes('..')) {
    throw new Error(`Недопустимое имя сценария: ${name}`);
  }
  return path.join(SCRIPTS_DIR, `${safeName}.js`);
}

async function runScenarios(names) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('Передайте минимум один сценарий для запуска.');
  }

  const config = await loadConfig();
  const email = process.env.WINWINBOT_EMAIL || config.email;
  const password = process.env.WINWINBOT_PASSWORD || config.password;
  const scenarioTimeoutMs = Number(config.scenarioTimeoutMs) > 0 ? Number(config.scenarioTimeoutMs) : 180000;

  if (!email || !password) {
    throw new Error('Не заданы email/password. Укажите в config.json или через переменные окружения.');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();

  const summary = [];

  try {
    await login(page, email, password);

    for (const name of names) {
      logger.info(`Запуск сценария: ${name}`);
      const scriptPath = resolveScriptPath(name);

      if (!page || page.isClosed()) {
        logger.warn('Текущая вкладка была закрыта сценарием. Открываю новую вкладку.');
        page = await context.newPage();
      }

      try {
        await fs.access(scriptPath);
        delete require.cache[require.resolve(scriptPath)];
        const script = require(scriptPath);

        if (typeof script !== 'function') {
          throw new Error('Сценарий должен экспортировать функцию module.exports = async (page) => {...}');
        }

        await Promise.race([
          script(page),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Таймаут сценария (${scenarioTimeoutMs} ms)`)), scenarioTimeoutMs)
          ),
        ]);
        logger.info(`Сценарий выполнен: ${name}`);
        summary.push({ name, ok: true });
      } catch (err) {
        if (page && !page.isClosed()) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const safeName = name.replace(/[\/\\:*?"<>|]/g, '_');
          const failPng = path.join(__dirname, '.tmp', `run-fail-${safeName}-${stamp}.png`);
          const failHtml = path.join(__dirname, '.tmp', `run-fail-${safeName}-${stamp}.html`);
          await fs.mkdir(path.join(__dirname, '.tmp'), { recursive: true }).catch(() => {});
          await page.screenshot({ path: failPng, fullPage: true }).catch(() => {});
          const html = await page.content().catch(() => '');
          if (html) {
            await fs.writeFile(failHtml, html, 'utf-8').catch(() => {});
          }
          logger.warn(`Диагностика падения сохранена: ${failPng}`);
        }
        logger.error(`Ошибка сценария ${name}: ${err.message}`);
        summary.push({ name, ok: false, error: err.message });
      }

      await safePause(page, 700);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { summary };
}

module.exports = {
  runScenarios,
};
