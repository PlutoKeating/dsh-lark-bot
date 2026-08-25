import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Document, isMap, isSeq, parseDocument } from 'yaml';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';
import { resolveDshHome } from './dsh-runtime.js';
import {
  ModelsDevCatalog,
  type CatalogProvider,
  type ModelCatalog,
} from './model-catalog.js';

export const DEEPSEEK_NAMESPACE = 'llm-deepseek';
export const DEEPSEEK_PROVIDER = 'deepseek-official';
export const DEEPSEEK_DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
export const PIAI_NAMESPACE = 'llm-pi-ai';
export const AGENT_DEFAULT_MODEL_NAMESPACE = 'agent-default-model';

/**
 * Wire protocols a dsh-llm-pi-ai profile may name. Mirrors
 * `supportedProtocols()` from @deepseek-ai/dsh-llm-pi-ai; anything else is
 * refused at configuration time by the official validator.
 */
export const SUPPORTED_PI_AI_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const;
export type PiAiProtocol = (typeof SUPPORTED_PI_AI_PROTOCOLS)[number];

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
/** POSIX identifier rule enforced by dsh-credentials for `.credentials.yaml`. */
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface DshModelEntry {
  id: string;
  name: string | undefined;
  contextWindow: number | undefined;
  maxTokens: number | undefined;
  inputModalities?: Array<'text' | 'image'> | undefined;
  imagePixelBudget?: number | undefined;
  imageMaxBytes?: number | undefined;
  /** Runtime catalog metadata; not written into the provider settings schema. */
  reasoningEfforts?: string[] | undefined;
}

const VISION_MODEL_ID_TOKEN = /(^|[-_.])(vision|vlm|vl|4v)([-_.]|$)/i;
const VISION_MODEL_ID_GPT4O = /(^|[-_.])4o([-_.]|$)/i;
const VISION_MODEL_ID_IMAGE = /image/i;

/**
 * Whether a model id signals image (vision) capabilities. The upstream harness
 * rejects image input for a model whose `inputModalities` does not include
 * `'image'`, so a vision model whose modality is left unset silently fails the
 * whole turn. This is a conservative name heuristic, used as a fallback when
 * the models.dev catalog does not declare the modality.
 */
export function isVisionModelId(modelId: string): boolean {
  return (
    VISION_MODEL_ID_TOKEN.test(modelId) ||
    VISION_MODEL_ID_GPT4O.test(modelId) ||
    VISION_MODEL_ID_IMAGE.test(modelId)
  );
}

/**
 * Default the input modalities for a vision-capable model to `['text','image']`.
 * `current` is the explicitly configured value (undefined when unset); pass
 * `catalogDeclaresImage` when the models.dev catalog marks the model as image
 * capable. Returns `current` unchanged for non-vision models so no model
 * config is rewritten; for vision models it guarantees both `text` and `image`
 * are declared.
 */
export function normalizeVisionModelInputModalities(
  id: string,
  current: Array<'text' | 'image'> | undefined,
  catalogDeclaresImage: boolean,
): Array<'text' | 'image'> | undefined {
  const isVision = catalogDeclaresImage || isVisionModelId(id);
  if (!isVision) return current;
  const result = new Set<'text' | 'image'>(current ?? []);
  result.add('text');
  result.add('image');
  return [...result];
}

export interface DshProviderSummary {
  id: string;
  displayName: string;
  namespace: string;
  configured: boolean;
  credentialRef: string | undefined;
  credentialReady: boolean;
  models: DshModelEntry[];
  /** Whether dsh-lark-bot can add/update/remove this provider via chat. */
  managed: boolean;
}

export interface DshProviderManagerOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  settingsFile?: string;
  credentialsFile?: string;
  catalog?: ModelCatalog;
}

export interface DshModelSelection {
  provider: string;
  model: string;
}

export interface DshPiAiProviderInput {
  id: string;
  displayName?: string;
  apiKeyEnv?: string;
  api?: string;
  baseURL?: string;
  models?: DshModelEntry[];
}

const LOCK_TIMEOUT_MS = 10_000;
const PUBLIC_MODEL_CATALOG = new ModelsDevCatalog();

function isMapLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultModelSelectionFromSettings(
  settings: Record<string, unknown>,
): DshModelSelection | undefined {
  const section = settings[AGENT_DEFAULT_MODEL_NAMESPACE];
  if (typeof section === 'string') {
    return { provider: DEEPSEEK_PROVIDER, model: section };
  }
  if (isMapLike(section) && typeof section.model === 'string') {
    return {
      provider: typeof section.provider === 'string' ? section.provider : DEEPSEEK_PROVIDER,
      model: section.model,
    };
  }
  return undefined;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseModels(value: unknown): DshModelEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models: DshModelEntry[] = [];
  for (const raw of value) {
    if (!isMapLike(raw) || typeof raw.id !== 'string' || raw.id.length === 0) continue;
    const configuredModalities = Array.isArray(raw.inputModalities)
      ? raw.inputModalities.filter(
        (modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image',
      )
      : undefined;
    models.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      contextWindow:
        typeof raw.contextWindow === 'number' ? raw.contextWindow : undefined,
      maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
      // A vision model whose modality is unset must still declare image input
      // (issue #96): without it the upstream harness rejects the image and the
      // whole turn fails.
      inputModalities: normalizeVisionModelInputModalities(
        raw.id,
        configuredModalities,
        false,
      ),
      imagePixelBudget:
        typeof raw.imagePixelBudget === 'number' ? raw.imagePixelBudget : undefined,
      imageMaxBytes: typeof raw.imageMaxBytes === 'number' ? raw.imageMaxBytes : undefined,
    });
  }
  return models;
}

/** Raw model entries preserved verbatim so exotic fields survive round-trips. */
function rawModels(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isMapLike(entry));
}

function modelRecord(input: DshModelEntry): Record<string, unknown> {
  const record: Record<string, unknown> = { id: input.id };
  if (input.name !== undefined) record.name = input.name;
  if (input.contextWindow !== undefined) record.contextWindow = input.contextWindow;
  if (input.maxTokens !== undefined) record.maxTokens = input.maxTokens;
  // Ensure a vision model is persisted with image input declared (issue #96),
  // even when `/model add` was issued without `--input-modalities`.
  const modalities = normalizeVisionModelInputModalities(
    input.id,
    input.inputModalities,
    false,
  );
  if (modalities !== undefined) record.inputModalities = modalities;
  if (input.imagePixelBudget !== undefined) record.imagePixelBudget = input.imagePixelBudget;
  if (input.imageMaxBytes !== undefined) record.imageMaxBytes = input.imageMaxBytes;
  return record;
}

function normalizedOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function catalogProviderFor(
  providers: readonly CatalogProvider[],
  input: { id: string; baseURL: unknown; credentialRef: string | undefined },
): CatalogProvider | undefined {
  const byId = providers.find((provider) => provider.id === input.id);
  if (byId) return byId;
  const byQualifiedId = providers.find(
    (provider) => input.id.startsWith(`${provider.id}-`) || input.id.endsWith(`-${provider.id}`),
  );
  if (byQualifiedId) return byQualifiedId;
  const origin = normalizedOrigin(input.baseURL);
  const byApi = origin === undefined
    ? undefined
    : providers.find((provider) => normalizedOrigin(provider.api) === origin);
  if (byApi) return byApi;
  return input.credentialRef === undefined || origin !== undefined
    ? undefined
    : providers.find((provider) => provider.env.includes(input.credentialRef!));
}

function mergeCatalogModels(
  catalog: CatalogProvider | undefined,
  configured: DshModelEntry[] | undefined,
): DshModelEntry[] {
  const models = new Map<string, DshModelEntry>();
  for (const model of catalog?.models ?? []) models.set(model.id, model);
  for (const model of configured ?? []) {
    const discovered = models.get(model.id);
    models.set(model.id, {
      id: model.id,
      name: model.name ?? discovered?.name,
      contextWindow: model.contextWindow ?? discovered?.contextWindow,
      maxTokens: model.maxTokens ?? discovered?.maxTokens,
      // The catalog marks a model image-capable via inputModalities; when the
      // user configured the model without declaring it, default the modality so
      // the harness accepts images (issue #96).
      inputModalities: normalizeVisionModelInputModalities(
        model.id,
        model.inputModalities ?? discovered?.inputModalities,
        discovered?.inputModalities?.includes('image') ?? false,
      ),
      imagePixelBudget: model.imagePixelBudget ?? discovered?.imagePixelBudget,
      imageMaxBytes: model.imageMaxBytes ?? discovered?.imageMaxBytes,
      reasoningEfforts: model.reasoningEfforts ?? discovered?.reasoningEfforts,
    });
  }
  return [...models.values()];
}

function validateProviderId(id: string): void {
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(`provider id 必须是小写字母开头且仅含 a-z 0-9 . _ -，得到 "${id}"`);
  }
}

/**
 * Normalize an OpenAI-compatible gateway base URL. A bare origin (no path) is
 * completed with `/v1` (the conventional versioned route used by most
 * OpenAI-compatible gateways, including KingAI); a full chat endpoint is kept
 * as-is. Throws a clear error when the URL is not parseable / not http(s).
 */
export function normalizeBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`baseURL 不是合法 URL：${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`baseURL 仅支持 http/https：${url}`);
  }
  validateBaseUrl(url);
  const pathname = stripApiOperationSuffix(parsed.pathname);
  if (pathname === '') {
    parsed.pathname = '/v1';
  } else {
    parsed.pathname = pathname;
  }
  return parsed.toString();
}

/**
 * Normalize a deepseek-official base URL. The dsh llm-deepseek adapter also
 * appends its own API paths (`${baseURL}/chat/completions`), so a full
 * endpoint pasted by the user must be trimmed the same way — but unlike
 * pi-ai gateways the official API serves chat at the bare root, so we must
 * NOT default an empty path to `/v1`.
 */
export function normalizeDeepseekBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`baseURL 不是合法 URL：${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`baseURL 仅支持 http/https：${url}`);
  }
  validateBaseUrl(url);
  const pathname = stripApiOperationSuffix(parsed.pathname);
  if (pathname === '' || pathname === '/') {
    // Keep the official bare-root form (https://api.deepseek.com) without a
    // trailing slash; the adapter appends its own API paths.
    return parsed.origin;
  }
  parsed.pathname = pathname;
  return parsed.toString();
}

/**
 * The dsh pi-ai / llm-deepseek adapters build request URLs by appending the
 * API operation path to the configured base URL (e.g.
 * `${baseURL}/chat/completions`). Users routinely paste the full endpoint
 * from gateway docs, which would otherwise produce a doubled path and a
 * gateway 404 — trim those operation suffixes here.
 */
const API_OPERATION_SUFFIXES = ['/chat/completions', '/responses', '/messages'];

function stripApiOperationSuffix(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  for (const suffix of API_OPERATION_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, trimmed.length - suffix.length).replace(/\/+$/, '');
    }
  }
  return trimmed;
}

function validateBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`baseURL 不是合法 URL：${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`baseURL 仅支持 http/https：${url}`);
  }
}

function assertProtocol(api: string): asserts api is PiAiProtocol {
  if (!(SUPPORTED_PI_AI_PROTOCOLS as readonly string[]).includes(api)) {
    throw new Error(`不支持的 API 协议 "${api}"，可选：${SUPPORTED_PI_AI_PROTOCOLS.join(' / ')}`);
  }
}

/** Comment-preserving leaf patch used by dsh-settings-file. */
function patchNode(
  document: Document,
  path: readonly (string | number)[],
  current: unknown,
  next: unknown,
): void {
  if (isMapLike(current) && isMapLike(next)) {
    for (const key of Object.keys(current)) {
      if (!(key in next)) document.deleteIn([...path, key]);
    }
    for (const [key, value] of Object.entries(next)) {
      patchNode(document, [...path, key], current[key], value);
    }
    return;
  }
  if (!deepEqualJson(current, next)) document.setIn([...path], next);
}

/** Add or update one runtime model without replacing the surrounding YAML sequence. */
function patchRuntimeModelModalities(
  document: Document,
  modelId: string,
  modalities: Array<'text' | 'image'>,
): void {
  const modelsPath = [DEEPSEEK_NAMESPACE, 'models'];
  const modelsNode = document.getIn(modelsPath, true);
  if (!isSeq(modelsNode)) {
    document.setIn(modelsPath, [{ id: modelId, inputModalities: modalities }]);
    return;
  }

  const modelIndex = modelsNode.items.findIndex((item) =>
    isMap(item) && item.get('id') === modelId,
  );
  if (modelIndex === -1) {
    modelsNode.add({ id: modelId, inputModalities: modalities });
    return;
  }
  document.setIn([...modelsPath, modelIndex, 'inputModalities'], modalities);
}

function parseYamlMap(text: string | undefined, filename: string): Record<string, unknown> {
  if (text === undefined || text.trim().length === 0) return {};
  const document = parseDocument(text, { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new Error(`invalid dsh config at ${filename}: ${document.errors.map((e) => e.message).join('; ')}`);
  }
  const root = document.toJS() ?? {};
  if (!isMapLike(root)) {
    throw new TypeError(`dsh config ${filename} must be a mapping`);
  }
  return root;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process writer lock compatible with dsh's own protocol: an exclusive
 * `<file>.lock` sibling created with the `wx` flag, released by removal.
 */
async function withFileLock<T>(filename: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filename}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(`dsh config lock timed out at ${lockPath}`);
      }
      await sleep(80 + Math.random() * 120);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export class DshProviderManager {
  private readonly home: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly settingsFile: string;
  private readonly credentialsFile: string;
  private readonly catalog: ModelCatalog;

  constructor(options: DshProviderManagerOptions = {}) {
    this.home = options.home ?? homedir();
    this.env = options.env ?? process.env;
    const dshHome = resolveDshHome(this.home, this.env);
    this.settingsFile = options.settingsFile ?? join(dshHome, 'settings.yaml');
    this.credentialsFile = options.credentialsFile ?? join(dshHome, '.credentials.yaml');
    const catalogUrl = this.env.DSH_LARK_MODEL_CATALOG_URL;
    this.catalog = options.catalog ?? (
      catalogUrl ? new ModelsDevCatalog({ url: catalogUrl }) : PUBLIC_MODEL_CATALOG
    );
  }

  async readSettings(): Promise<Record<string, unknown>> {
    return parseYamlMap(await readOptional(this.settingsFile), this.settingsFile);
  }

  async readCredentials(): Promise<Record<string, string>> {
    const root = parseYamlMap(await readOptional(this.credentialsFile), this.credentialsFile);
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(root)) {
      if (typeof value === 'string' && value.length > 0) entries[key] = value;
    }
    return entries;
  }

  async hasCredential(ref: string): Promise<boolean> {
    const entries = await this.readCredentials();
    if (entries[ref]) return true;
    return Boolean(this.env[ref]?.trim());
  }

  async listCredentialRefs(): Promise<string[]> {
    return Object.keys(await this.readCredentials());
  }

  async listProviders(): Promise<DshProviderSummary[]> {
    const settings = await this.readSettings();
    let catalogProviders: CatalogProvider[] = [];
    try {
      catalogProviders = await this.catalog.listProviders();
    } catch (error) {
      // `models.dev` (the default of DSH_LARK_MODEL_CATALOG_URL) may be
      // unreachable from some regions (e.g. mainland China), so a refresh
      // timeout is expected and benign — the catalog is best-effort with a
      // short-TTL cache and stale-on-error. Keep it as informational noise
      // rather than a per-invocation warning (issue #112 Bug E).
      log.info('model-catalog', 'refresh-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const providers = [
      await this.describeDeepseek(settings, catalogProviders),
      ...(await this.describePiAi(settings, catalogProviders)),
    ];
    const configuredDefault = defaultModelSelectionFromSettings(settings);
    if (!configuredDefault) return providers;
    return providers.map((provider) => {
      if (
        provider.id !== configuredDefault.provider
        || provider.models.some((model) => model.id === configuredDefault.model)
      ) return provider;
      return {
        ...provider,
        models: [...provider.models, {
          id: configuredDefault.model,
          name: undefined,
          contextWindow: undefined,
          maxTokens: undefined,
        }],
      };
    });
  }

  private async describeDeepseek(
    settings: Record<string, unknown>,
    catalogProviders: readonly CatalogProvider[],
  ): Promise<DshProviderSummary> {
    const deepseek = isMapLike(settings[DEEPSEEK_NAMESPACE])
      ? settings[DEEPSEEK_NAMESPACE]
      : {};
    const credentialRef =
      typeof deepseek.apiKeyEnv === 'string' && deepseek.apiKeyEnv.length > 0
        ? deepseek.apiKeyEnv
        : DEEPSEEK_DEFAULT_API_KEY_ENV;
    const catalog = catalogProviderFor(catalogProviders, {
      id: DEEPSEEK_PROVIDER,
      baseURL: deepseek.baseURL,
      credentialRef,
    });
    return {
      id: DEEPSEEK_PROVIDER,
      displayName: catalog?.name ?? DEEPSEEK_PROVIDER,
      namespace: DEEPSEEK_NAMESPACE,
      configured: Object.keys(deepseek).length > 0,
      credentialRef,
      credentialReady: await this.hasCredential(credentialRef),
      models: mergeCatalogModels(catalog, parseModels(deepseek.models)),
      managed: true,
    };
  }

  private async describePiAi(
    settings: Record<string, unknown>,
    catalogProviders: readonly CatalogProvider[],
  ): Promise<DshProviderSummary[]> {
    const piAi = isMapLike(settings[PIAI_NAMESPACE]) ? settings[PIAI_NAMESPACE] : {};
    const providers = isMapLike(piAi.providers) ? piAi.providers : {};
    const summaries: DshProviderSummary[] = [];
    for (const [id, raw] of Object.entries(providers)) {
      const profile = isMapLike(raw) ? raw : {};
      const ref =
        typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
          ? profile.apiKeyEnv
          : undefined;
      const catalog = catalogProviderFor(catalogProviders, {
        id,
        baseURL: profile.baseURL,
        credentialRef: ref,
      });
      summaries.push({
        id,
        displayName: typeof profile.displayName === 'string'
          ? profile.displayName
          : catalog?.name ?? id,
        namespace: PIAI_NAMESPACE,
        configured: true,
        credentialRef: ref,
        credentialReady: ref === undefined ? false : await this.hasCredential(ref),
        models: mergeCatalogModels(catalog, parseModels(profile.models)),
        managed: true,
      });
    }
    return summaries;
  }

  async defaultModel(): Promise<string | undefined> {
    return (await this.defaultModelSelection())?.model;
  }

  /** Read the full `agent-default-model` selection (provider + model). */
  async defaultModelSelection(): Promise<DshModelSelection | undefined> {
    return defaultModelSelectionFromSettings(await this.readSettings());
  }

  /**
   * Resolve the provider that owns a model id across the configured providers.
   * Explicitly configured models (pi-ai providers / llm-deepseek section) win
   * over the built-in deepseek default catalog.
   */
  async resolveProviderForModel(modelId: string): Promise<DshProviderSummary | undefined> {
    const providers = await this.listProviders();
    const explicit = providers.filter((provider) => provider.configured);
    const owned = explicit.find((provider) =>
      provider.models.some((model) => model.id === modelId),
    );
    if (owned) return owned;
    return providers.find((provider) => provider.models.some((model) => model.id === modelId));
  }

  /** Resolve a bare model id or an explicit `<provider>/<model>` selection. */
  async resolveModelRoute(selection: string): Promise<DshModelSelection | undefined> {
    const separator = selection.indexOf('/');
    if (separator > 0) {
      const providerId = selection.slice(0, separator);
      const modelId = selection.slice(separator + 1);
      const provider = (await this.listProviders()).find(
        (candidate) => candidate.id === providerId,
      );
      if (!provider?.models.some((model) => model.id === modelId)) return undefined;
      return { provider: provider.id, model: modelId };
    }
    const provider = await this.resolveProviderForModel(selection);
    if (!provider) return undefined;
    return { provider: provider.id, model: selection };
  }

  /** Resolve a model route and make its managed runtime catalog ready. */
  async resolveRuntimeModelRoute(selection: string): Promise<DshModelSelection | undefined> {
    const route = await this.resolveModelRoute(selection);
    if (route !== undefined) await this.ensureRuntimeModelModalities(route);
    return route;
  }

  async setDefaultModel(model: string): Promise<void> {
    if (!model.trim()) throw new Error('默认模型不能为空');
    const route = await this.resolveModelRoute(model);
    if (!route) {
      throw new Error(
        `模型 ${model} 未在任何已配置 provider 中找到，无法设为默认；可先 /model add 或 /provider add 添加。`,
      );
    }
    // dsh's official `agent-default-model` schema requires BOTH provider and
    // model; writing only `model` makes the section unreadable for the runtime.
    await this.writeNamespace(AGENT_DEFAULT_MODEL_NAMESPACE, {
      provider: route.provider,
      model: route.model,
    });
  }

  async upsertDeepseekProvider(input: {
    baseURL?: string;
    apiKeyEnv?: string;
    apiKey?: string;
  }): Promise<void> {
    const settings = await this.readSettings();
    const current = isMapLike(settings[DEEPSEEK_NAMESPACE])
      ? settings[DEEPSEEK_NAMESPACE]
      : {};
    const section = { ...current };
    if (input.baseURL !== undefined) {
      section.baseURL = normalizeDeepseekBaseUrl(input.baseURL);
    }
    if (input.apiKeyEnv !== undefined) section.apiKeyEnv = input.apiKeyEnv;
    if (input.apiKey !== undefined) {
      const ref =
        typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0
          ? section.apiKeyEnv
          : DEEPSEEK_DEFAULT_API_KEY_ENV;
      await this.setCredential(ref, input.apiKey);
    }
    await this.writeNamespace(DEEPSEEK_NAMESPACE, section);
  }

  async removeDeepseekProvider(): Promise<void> {
    const settings = await this.readSettings();
    const section = isMapLike(settings[DEEPSEEK_NAMESPACE])
      ? settings[DEEPSEEK_NAMESPACE]
      : {};
    await this.deleteNamespace(DEEPSEEK_NAMESPACE);
    await this.removeCredential(
      typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0
        ? section.apiKeyEnv
        : DEEPSEEK_DEFAULT_API_KEY_ENV,
    );
  }

  async addDeepseekModel(input: DshModelEntry): Promise<void> {
    const settings = await this.readSettings();
    const current = isMapLike(settings[DEEPSEEK_NAMESPACE])
      ? settings[DEEPSEEK_NAMESPACE]
      : {};
    const models = rawModels(current.models);
    if (models.some((model) => model.id === input.id)) {
      throw new Error(`模型 ${input.id} 已存在于 ${DEEPSEEK_PROVIDER}`);
    }
    await this.writeNamespace(DEEPSEEK_NAMESPACE, {
      ...current,
      models: [...models, modelRecord(input)],
    });
  }

  /**
   * Ensure the selected DeepSeek vision model is present in the catalog that
   * the managed SDK/ACP runtime actually consumes. The upstream DeepSeek
   * adapter treats an unlisted model as text-only even when its id identifies
   * a vision endpoint, so read-time normalization alone is insufficient.
   * Returns true only when settings were changed.
   */
  async ensureRuntimeModelModalities(route: DshModelSelection): Promise<boolean> {
    if (route.provider !== DEEPSEEK_PROVIDER || !isVisionModelId(route.model)) return false;
    await mkdir(dirname(this.settingsFile), { recursive: true });
    let changed = false;
    await withFileLock(this.settingsFile, async () => {
      const text = await readOptional(this.settingsFile);
      const root = parseYamlMap(text, this.settingsFile);
      const current = isMapLike(root[DEEPSEEK_NAMESPACE])
        ? root[DEEPSEEK_NAMESPACE]
        : {};
      const models = rawModels(current.models);
      const index = models.findIndex((model) => model.id === route.model);
      const existing = index === -1 ? undefined : models[index];
      const configured = Array.isArray(existing?.inputModalities)
        ? existing.inputModalities.filter(
          (modality): modality is 'text' | 'image' =>
            modality === 'text' || modality === 'image',
        )
        : undefined;
      const modalities = normalizeVisionModelInputModalities(
        route.model,
        configured,
        false,
      )!;
      if (existing !== undefined && deepEqualJson(existing.inputModalities, modalities)) return;

      const nextModel = { ...(existing ?? { id: route.model }), inputModalities: modalities };
      const section = {
        ...current,
        models: index === -1
          ? [...models, nextModel]
          : models.map((model, modelIndex) => modelIndex === index ? nextModel : model),
      };
      if (text === undefined || text.trim().length === 0) {
        await writeFileAtomic(
          this.settingsFile,
          new Document({ [DEEPSEEK_NAMESPACE]: section }).toString(),
          {},
        );
        changed = true;
        return;
      }
      const document = parseDocument(text);
      if (document.errors.length > 0) {
        throw new Error(`invalid dsh settings at ${this.settingsFile}`);
      }
      patchRuntimeModelModalities(document, route.model, modalities);
      await writeFileAtomic(this.settingsFile, document.toString(), {});
      changed = true;
    });
    return changed;
  }

  async removeDeepseekModel(id: string): Promise<boolean> {
    const settings = await this.readSettings();
    const current = isMapLike(settings[DEEPSEEK_NAMESPACE])
      ? settings[DEEPSEEK_NAMESPACE]
      : {};
    const models = rawModels(current.models);
    if (models.length === 0) return false;
    const next = models.filter((model) => model.id !== id);
    if (next.length === models.length) return false;
    await this.writeNamespace(DEEPSEEK_NAMESPACE, { ...current, models: next });
    return true;
  }

  async upsertPiAiProvider(input: DshPiAiProviderInput): Promise<void> {
    validateProviderId(input.id);
    const settings = await this.readSettings();
    const piAi = isMapLike(settings[PIAI_NAMESPACE]) ? settings[PIAI_NAMESPACE] : {};
    const providers = isMapLike(piAi.providers) ? piAi.providers : {};
    const existing = isMapLike(providers[input.id]) ? providers[input.id] : undefined;
    const section: Record<string, unknown> = existing === undefined ? {} : { ...existing };

    if (input.displayName !== undefined) section.displayName = input.displayName;
    if (input.apiKeyEnv !== undefined) section.apiKeyEnv = input.apiKeyEnv;
    if (input.api !== undefined) {
      assertProtocol(input.api);
      section.api = input.api;
    }
    if (input.baseURL !== undefined) {
      section.baseURL = normalizeBaseUrl(input.baseURL);
    }
    if (input.models !== undefined) section.models = input.models.map(modelRecord);

    if (existing === undefined) {
      if (typeof section.api !== 'string') {
        throw new Error('新增自定义 provider 必须指定 --api（openai-completions / openai-responses / anthropic-messages）');
      }
      assertProtocol(section.api);
      if (typeof section.baseURL !== 'string') {
        throw new Error('新增自定义 provider 必须指定 --base-url');
      }
      section.baseURL = normalizeBaseUrl(section.baseURL);
      const models = rawModels(section.models);
      if (models.length === 0) {
        throw new Error('新增自定义 provider 至少需要一个 --model（models 不能为空）');
      }
      for (const model of models) {
        if (typeof model.id !== 'string' || model.id.length === 0) {
          throw new Error(`--model 缺少有效 id：${JSON.stringify(model)}`);
        }
      }
    }

    await this.writeNamespace(PIAI_NAMESPACE, {
      ...piAi,
      providers: { ...providers, [input.id]: section },
    });
  }

  async removePiAiProvider(id: string): Promise<boolean> {
    const settings = await this.readSettings();
    const piAi = isMapLike(settings[PIAI_NAMESPACE]) ? settings[PIAI_NAMESPACE] : {};
    const providers = isMapLike(piAi.providers) ? piAi.providers : {};
    if (!(id in providers)) return false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(providers)) {
      if (key !== id) next[key] = value;
    }
    if (Object.keys(next).length === 0) {
      await this.deleteNamespace(PIAI_NAMESPACE);
    } else {
      await this.writeNamespace(PIAI_NAMESPACE, { ...piAi, providers: next });
    }
    return true;
  }

  /**
   * Heal the common misconfiguration where a credential was stored under the
   * provider id (`/key set kingapi …`) but the provider never got an
   * apiKeyEnv. Links the ref to the matching pi-ai provider once; returns
   * true when a link was applied. Idempotent and a no-op when the provider
   * already has a ref or no matching credential exists.
   */
  async linkCredentialRefIfMissing(providerId: string): Promise<boolean> {
    const settings = await this.readSettings();
    const piAi = isMapLike(settings[PIAI_NAMESPACE]) ? settings[PIAI_NAMESPACE] : {};
    const providers = isMapLike(piAi.providers) ? piAi.providers : {};
    const section = isMapLike(providers[providerId]) ? providers[providerId] : {};
    if (typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0) {
      return false;
    }
    if (!(await this.hasCredential(providerId))) return false;
    await this.upsertPiAiProvider({ id: providerId, apiKeyEnv: providerId });
    return true;
  }

  async addPiAiModel(providerId: string, input: DshModelEntry): Promise<void> {
    validateProviderId(providerId);
    const settings = await this.readSettings();
    const piAi = isMapLike(settings[PIAI_NAMESPACE]) ? settings[PIAI_NAMESPACE] : {};
    const providers = isMapLike(piAi.providers) ? piAi.providers : {};
    const section = isMapLike(providers[providerId]) ? providers[providerId] : undefined;
    if (section === undefined) {
      throw new Error(`provider ${providerId} 不存在，请先用 /provider add 创建`);
    }
    const models = rawModels(section.models);
    if (models.some((model) => model.id === input.id)) {
      throw new Error(`模型 ${input.id} 已存在于 ${providerId}`);
    }
    await this.writeNamespace(PIAI_NAMESPACE, {
      ...piAi,
      providers: {
        ...providers,
        [providerId]: { ...section, models: [...models, modelRecord(input)] },
      },
    });
  }

  async removePiAiModel(providerId: string, modelId: string): Promise<boolean> {
    const settings = await this.readSettings();
    const piAi = isMapLike(settings[PIAI_NAMESPACE]) ? settings[PIAI_NAMESPACE] : {};
    const providers = isMapLike(piAi.providers) ? piAi.providers : {};
    const section = isMapLike(providers[providerId]) ? providers[providerId] : undefined;
    if (section === undefined) {
      throw new Error(`provider ${providerId} 不存在`);
    }
    const models = rawModels(section.models);
    const next = models.filter((model) => model.id !== modelId);
    if (next.length === models.length) return false;
    await this.writeNamespace(PIAI_NAMESPACE, {
      ...piAi,
      providers: {
        ...providers,
        [providerId]: { ...section, models: next },
      },
    });
    return true;
  }

  async setCredential(ref: string, value: string): Promise<void> {
    if (!CREDENTIAL_REF_PATTERN.test(ref)) {
      throw new Error(`非法凭据引用名：${ref}（应为 POSIX 环境变量名，如 OPENAI_API_KEY）`);
    }
    if (value.length === 0) throw new Error('凭据值不能为空');
    await mkdir(dirname(this.credentialsFile), { recursive: true, mode: 0o700 });
    await withFileLock(this.credentialsFile, async () => {
      const text = await readOptional(this.credentialsFile);
      const root = parseYamlMap(text, this.credentialsFile);
      const document = text === undefined || text.trim().length === 0
        ? new Document()
        : parseDocument(text);
      if (document.errors.length > 0) {
        throw new Error(`invalid dsh credentials at ${this.credentialsFile}`);
      }
      patchNode(document, [ref], root[ref], value);
      await writeFileAtomic(this.credentialsFile, document.toString(), { mode: 0o600 });
    });
  }

  async removeCredential(ref: string): Promise<boolean> {
    let removed = false;
    await withFileLock(this.credentialsFile, async () => {
      const text = await readOptional(this.credentialsFile);
      if (text === undefined || text.trim().length === 0) return;
      const document = parseDocument(text);
      if (document.errors.length > 0) {
        throw new Error(`invalid dsh credentials at ${this.credentialsFile}`);
      }
      if (document.has(ref)) {
        document.deleteIn([ref]);
        removed = true;
        await writeFileAtomic(this.credentialsFile, document.toString(), { mode: 0o600 });
      }
    });
    return removed;
  }

  private async writeNamespace(ns: string, section: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.settingsFile), { recursive: true });
    await withFileLock(this.settingsFile, async () => {
      const text = await readOptional(this.settingsFile);
      const root = parseYamlMap(text, this.settingsFile);
      if (text === undefined || text.trim().length === 0) {
        await writeFileAtomic(this.settingsFile, new Document({ [ns]: section }).toString(), {});
        return;
      }
      const document = parseDocument(text);
      if (document.errors.length > 0) {
        throw new Error(`invalid dsh settings at ${this.settingsFile}`);
      }
      patchNode(document, [ns], root[ns], section);
      await writeFileAtomic(this.settingsFile, document.toString(), {});
    });
  }

  private async deleteNamespace(ns: string): Promise<void> {
    await withFileLock(this.settingsFile, async () => {
      const text = await readOptional(this.settingsFile);
      if (text === undefined || text.trim().length === 0) return;
      const document = parseDocument(text);
      if (document.errors.length > 0) {
        throw new Error(`invalid dsh settings at ${this.settingsFile}`);
      }
      if (document.has(ns)) {
        document.deleteIn([ns]);
        await writeFileAtomic(this.settingsFile, document.toString(), {});
      }
    });
  }
}
