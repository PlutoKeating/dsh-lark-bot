const DEFAULT_CATALOG_URL = 'https://models.dev/api.json';
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

export interface CatalogModel {
  id: string;
  name: string | undefined;
  contextWindow: number | undefined;
  maxTokens: number | undefined;
  inputModalities?: Array<'text' | 'image'> | undefined;
  reasoningEfforts?: string[] | undefined;
}

export interface CatalogProvider {
  id: string;
  name: string;
  api: string | undefined;
  env: string[];
  models: CatalogModel[];
}

export interface ModelCatalog {
  listProviders(): Promise<CatalogProvider[]>;
}

export interface ModelsDevCatalogOptions {
  url?: string;
  ttlMs?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function modelFromRecord(id: string, value: unknown): CatalogModel | undefined {
  if (!isRecord(value)) return undefined;
  const modalities = isRecord(value.modalities) ? value.modalities : {};
  const limit = isRecord(value.limit) ? value.limit : {};
  const reasoningEfforts = Array.isArray(value.reasoning_options)
    ? value.reasoning_options.flatMap((option) => {
      if (!isRecord(option) || option.type !== 'effort') return [];
      return strings(option.values);
    })
    : [];
  const inputModalities = strings(modalities.input).filter(
    (modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image',
  );
  return {
    id,
    name: typeof value.name === 'string' ? value.name : undefined,
    contextWindow: typeof limit.context === 'number' ? limit.context : undefined,
    maxTokens: typeof limit.output === 'number' ? limit.output : undefined,
    inputModalities: inputModalities.length > 0 ? inputModalities : undefined,
    reasoningEfforts: reasoningEfforts.length > 0 ? [...new Set(reasoningEfforts)] : undefined,
  };
}

function parseCatalog(value: unknown): CatalogProvider[] {
  if (!isRecord(value)) throw new Error('models.dev catalog root must be an object');
  const providers: CatalogProvider[] = [];
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !isRecord(raw.models)) continue;
    providers.push({
      id,
      name: raw.name,
      api: typeof raw.api === 'string' ? raw.api : undefined,
      env: strings(raw.env),
      models: Object.entries(raw.models).flatMap(([modelId, model]) => {
        const parsed = modelFromRecord(modelId, model);
        return parsed ? [parsed] : [];
      }),
    });
  }
  return providers;
}

export class ModelsDevCatalog implements ModelCatalog {
  private readonly url: string;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private snapshot: { loadedAt: number; providers: CatalogProvider[] } | undefined;
  private inflight: Promise<CatalogProvider[]> | undefined;

  constructor(options: ModelsDevCatalogOptions = {}) {
    this.url = options.url ?? DEFAULT_CATALOG_URL;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async listProviders(): Promise<CatalogProvider[]> {
    if (this.snapshot && this.now() - this.snapshot.loadedAt < this.ttlMs) {
      return this.snapshot.providers;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<CatalogProvider[]> {
    try {
      const response = await this.fetcher(this.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
        throw new Error('models.dev catalog exceeds size limit');
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) {
        throw new Error('models.dev catalog exceeds size limit');
      }
      const providers = parseCatalog(JSON.parse(text));
      this.snapshot = { loadedAt: this.now(), providers };
      return providers;
    } catch (error) {
      if (this.snapshot) return this.snapshot.providers;
      throw error;
    }
  }
}
