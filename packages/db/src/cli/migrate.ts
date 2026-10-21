import { resolve } from 'node:path';
import { openDatabase } from '../client.ts';

const dataDir = resolve(process.env.FLOWCHECK_DATA_DIR ?? resolve(import.meta.dirname, '../../../../data'));
const handle = openDatabase(resolve(dataDir, 'flowcheck.db'));
handle.close();
console.log(`Migrations applied to ${resolve(dataDir, 'flowcheck.db')}`);
