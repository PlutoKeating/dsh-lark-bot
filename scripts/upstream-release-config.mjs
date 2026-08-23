/**
 * Reviewed release baselines. The baseline itself is never announced: only
 * strictly newer versions become upstream-update issues.
 *
 * Verified against GitHub Releases and npm on 2026-08-23.
 */
export const UPSTREAMS = [
  {
    id: 'dsh',
    name: 'DeepSeek Harness (dsh)',
    repository: 'deepseek-ai/deepseek-harness',
    trackFrom: '0.1.1-rc.2',
    tagPrefix: 'dsh-v',
    npmPackages: [
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-sdk-client',
      '@deepseek-ai/dsh-sdk-jsonrpc-server',
      '@deepseek-ai/dsh-acp',
    ],
  },
  {
    id: 'dsh-tui',
    name: 'dsh-TUI',
    repository: 'ccch1mneyyy/dsh-TUI',
    trackFrom: '0.9.0',
    tagPrefix: 'v',
    npmPackages: ['@deepseek-harness-tui/dsh-tui'],
  },
];
