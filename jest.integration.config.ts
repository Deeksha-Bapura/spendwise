import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

// Integration tests hit a real Postgres (TEST_DATABASE_URL). Run serially.
const config = createJestConfig({
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/helpers/integration.env.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^server-only$": "<rootDir>/tests/helpers/empty.ts",
  },
  testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
  testTimeout: 30_000,
});

// better-auth and its deps ship ESM only, so let Jest's SWC transform them.
const integrationConfig = async () => {
  const resolved = await config();
  return {
    ...resolved,
    transformIgnorePatterns: [
      "/node_modules/(?!(\\.pnpm/)?(@prisma|better-auth|@better-auth|better-call|@better-fetch|jose|nanostores|rou3|defu|uncrypto|@noble|kysely)[@+/])",
    ],
  };
};

export default integrationConfig;
