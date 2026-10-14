import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';

const config = loadConfig();
if (!config.adminToken) console.warn('⚠️  ADMIN_TOKEN absent : l\'interface Olivier est désactivée.');
if (process.env.OPEN_ALL_DAY === '1') console.warn('⚠️  OPEN_ALL_DAY=1 : mode test, créneaux ouverts 24h/24.');
const app = await buildApp({ db: openDb(config.dbPath), config, logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
if (process.env.OPEN_ALL_DAY === '1') {
  // Mode développement uniquement : rappelle où ouvrir l'écran de la cuisine et quel code taper.
  console.log(`\n👉 Écran cuisine : http://localhost:${config.port}/admin   (code : ${config.adminToken})\n`);
}
