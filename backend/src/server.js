import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';

const config = loadConfig();
if (!config.adminToken) console.warn('⚠️  ADMIN_TOKEN absent : l\'interface Olivier est désactivée.');
const app = await buildApp({ db: openDb(config.dbPath), config, logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
