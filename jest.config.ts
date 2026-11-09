import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

// Unit + component tests (fast, no database). Component tests opt into jsdom
// with a `@jest-environment jsdom` docblock.
const config = createJestConfig({
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/helpers/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^server-only$": "<rootDir>/tests/helpers/empty.ts",
  },
  testMatch: ["<rootDir>/tests/unit/**/*.test.ts", "<rootDir>/tests/component/**/*.test.tsx"],
});

// jose ships ESM only, so let Jest's SWC transform it.
const unitConfig = async () => ({
  ...(await config()),
  transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?(jose)[@+/])"],
});

export default unitConfig;
