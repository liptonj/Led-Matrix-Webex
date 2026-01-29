/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/__tests__/**/*.ts",
    "**/__tests__/**/*.tsx",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
  ],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          moduleResolution: "node",
          esModuleInterop: true,
          jsx: "react-jsx",
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.d.ts",
    "!src/app/**/*.tsx", // Exclude React components for now
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  verbose: true,
  // Use jsdom for hook tests that require browser environment
  projects: [
    {
      displayName: "lib",
      testEnvironment: "node",
      testMatch: ["<rootDir>/src/lib/**/*.test.ts"],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            tsconfig: {
              moduleResolution: "node",
              esModuleInterop: true,
              jsx: "react-jsx",
            },
          },
        ],
      },
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
      },
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
    },
    {
      displayName: "hooks",
      testEnvironment: "jsdom",
      testMatch: ["<rootDir>/src/hooks/**/*.test.ts", "<rootDir>/src/hooks/**/*.test.tsx"],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            tsconfig: {
              moduleResolution: "node",
              esModuleInterop: true,
              jsx: "react-jsx",
            },
          },
        ],
      },
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
      },
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
    },
    {
      displayName: "app",
      testEnvironment: "jsdom",
      testMatch: ["<rootDir>/src/app/**/*.test.ts", "<rootDir>/src/app/**/*.test.tsx"],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            tsconfig: {
              moduleResolution: "node",
              esModuleInterop: true,
              jsx: "react-jsx",
            },
          },
        ],
      },
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
      },
      setupFilesAfterEnv: [
        "<rootDir>/jest.setup.ts",
        "<rootDir>/src/app/__tests__/setup.tsx",
      ],
    },
  ],
};
