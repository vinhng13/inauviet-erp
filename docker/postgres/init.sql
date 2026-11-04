-- Runs once, when the database volume is first created.
-- Separate database for `npm run test:e2e` (it is wiped on every test run).
CREATE DATABASE erp_test OWNER erp;
