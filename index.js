const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const {
  listScripts,
  deleteScript,
  getScriptContent,
  updateScriptContent,
  getRecordingSettings,
  updateRecordingSettings,
  startRecording,
  stopRecording,
  getRecordingStatus,
} = require('./recorder');
const { runScenarios } = require('./runner');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error(`Unhandled rejection: ${message}`);
});

app.use(express.json());
app.use('/ui', express.static(path.join(__dirname, 'ui')));

app.get('/', (_req, res) => {
  res.redirect('/ui/index.html');
});

app.get('/api/scripts', async (_req, res) => {
  try {
    const scripts = await listScripts();
    res.json({ ok: true, scripts });
  } catch (err) {
    logger.error(`Ошибка списка сценариев: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  const since = req.query.since || 0;
  const logs = logger.getLogs(since);
  const lastId = logs.length ? logs[logs.length - 1].id : Number(since) || 0;
  res.json({ ok: true, logs, lastId });
});

app.get('/api/record/status', (_req, res) => {
  res.json({ ok: true, status: getRecordingStatus() });
});

app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await getRecordingSettings();
    res.json({ ok: true, settings });
  } catch (err) {
    logger.error(`Ошибка чтения настроек: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const settings = await updateRecordingSettings(req.body || {});
    res.json({ ok: true, settings });
  } catch (err) {
    logger.error(`Ошибка сохранения настроек: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/record/start', async (req, res) => {
  try {
    const { name, autoLogin } = req.body || {};
    const settings = await getRecordingSettings();
    const finalAutoLogin = typeof autoLogin === 'boolean' ? autoLogin : settings.defaultAutoLogin;
    const result = await startRecording(name, { autoLogin: finalAutoLogin });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Ошибка запуска записи: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/record/stop', async (_req, res) => {
  try {
    const result = await stopRecording();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Ошибка остановки записи: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/run', async (req, res) => {
  try {
    if (getRecordingStatus().running) {
      throw new Error('Нельзя запускать сценарии во время активной записи.');
    }
    const { names } = req.body || {};
    const safeNames = Array.isArray(names) ? names : [];
    const result = await runScenarios(safeNames);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Ошибка запуска сценариев: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/scripts/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const result = await deleteScript(name);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Ошибка удаления сценария: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/scripts/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const result = await getScriptContent(name);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Ошибка чтения сценария: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/api/scripts/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { content } = req.body || {};
    const result = await updateScriptContent(name, content);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`Ошибка сохранения сценария: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  logger.info(`UI запущен: ${url}`);
  exec(`open "${url}"`, () => {});
});
