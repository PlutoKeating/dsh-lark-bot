import type { ModelCatalog } from '../../src/config/model-catalog.js';

export const TEST_MODEL_CATALOG: ModelCatalog = {
  listProviders: async () => [{
    id: 'deepseek',
    name: 'DeepSeek Test Provider',
    api: 'https://api.deepseek.example',
    env: ['DEEPSEEK_API_KEY'],
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'Flash',
        contextWindow: 1000,
        maxTokens: 100,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'Pro',
        contextWindow: 2000,
        maxTokens: 200,
      },
    ],
  }],
};
