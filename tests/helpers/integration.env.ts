import { config } from "dotenv";

config({ quiet: true });
// Point everything (including src/lib/db) at the test database.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL must be set for integration tests");
process.env.DATABASE_URL = testUrl;
process.env.LOG_LEVEL = "silent";
