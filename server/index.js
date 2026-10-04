import path from 'node:path';
import { createApp } from './app.js';
import { Collector } from './collector/index.js';
import { VERSION, loadConfig } from './config.js';
import { SettingsStore } from './settings.js';

const config = loadConfig();
const store = new SettingsStore(config.settingsPath);
const collector = new Collector(config);
const historyFile = path.join(path.dirname(config.settingsPath), 'history.json');

if (collector.history.load(historyFile)) console.log(`History restored from ${historyFile}`);
collector.start();

const server = createApp({ config, store, collector }).listen(config.port, () => {
  console.log(`Pi Dashboard ${VERSION} running on http://localhost:${config.port}`);
  console.log(`Settings config: ${config.settingsPath}`);
  console.log(`Auth required: ${config.adminToken ? 'Yes' : 'No (dev mode)'}`);
});

function shutdown() {
  collector.stop();
  try {
    collector.history.save(historyFile);
  } catch (error) {
    console.warn(`History not saved: ${error.message}`);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
