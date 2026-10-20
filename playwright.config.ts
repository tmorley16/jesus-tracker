import { defineConfig, devices } from '@playwright/test';

// Uses the Microsoft Edge already installed on this machine (no browser download).
// SwiftShader keeps WebGL (the map) working in headless mode.
const edge = { channel: 'msedge', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } };

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:4321', ...edge },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], ...edge } },
  ],
  // The artifact smoke test (ARTIFACT=1) runs against scripts/serve-artifact.mjs instead.
  webServer: process.env.ARTIFACT ? undefined : { command: 'npm run preview -- --port 4321', url: 'http://localhost:4321', reuseExistingServer: true, timeout: 60_000 },
});
