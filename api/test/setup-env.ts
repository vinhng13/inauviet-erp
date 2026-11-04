import { loadDotEnv } from '../src/config/dotenv';

loadDotEnv();
process.env.NODE_ENV = 'test';
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error('Set DATABASE_URL_TEST to a separate database for e2e tests (it is wiped on every run)');
process.env.DATABASE_URL = testUrl;
