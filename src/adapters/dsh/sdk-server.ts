import type { Context } from '@deepseek-ai/cordis';
import {
  admitEncodedImages,
  type EncodedImageAttachment,
} from '@deepseek-ai/dsh-attachment';
import {
  Config,
  HarnessSdkJsonRpcServer,
  type JsonRpcConfig,
} from '@deepseek-ai/dsh-sdk-jsonrpc-server';
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol';

export const name = 'sdk-jsonrpc-server';
export const inject = ['agents', 'attachments'];
export { Config };

function uploadImages(params: Record<string, unknown> | undefined): EncodedImageAttachment[] {
  if (!Array.isArray(params?.images) || params.images.length === 0) {
    throw new TypeError('attachment/upload images must be a non-empty array');
  }
  return params.images.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError(`attachment/upload images[${index}] must be an object`);
    }
    const image = value as Record<string, unknown>;
    if (typeof image.mediaType !== 'string' || typeof image.data !== 'string') {
      throw new TypeError(`attachment/upload images[${index}] requires mediaType and data`);
    }
    if (image.name !== undefined && typeof image.name !== 'string') {
      throw new TypeError(`attachment/upload images[${index}].name must be a string`);
    }
    return {
      mediaType: image.mediaType as EncodedImageAttachment['mediaType'],
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    };
  });
}

export class LarkSdkJsonRpcServer extends HarnessSdkJsonRpcServer {
  constructor(
    private readonly attachmentContext: Context,
    transport: JsonRpcLineTransport,
    options: { maxTokensAsSuccess?: boolean },
  ) {
    super(attachmentContext, transport, options);
  }

  override async handleRequest(
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    if (method === 'attachment/upload') {
      const attachments = await admitEncodedImages(
        this.attachmentContext.attachments,
        uploadImages(params),
      );
      return { attachments };
    }
    return super.handleRequest(method, params);
  }
}

/** Official SDK stdio server with one attachment-admission extension. */
export function apply(ctx: Context, config: JsonRpcConfig): void {
  const rootFiber = ctx.root.fiber;
  const input = config.input ?? process.stdin;
  const output = config.output ?? process.stdout;
  const exit = config.exit ?? ((code: number) => process.exit(code));
  const transport = new JsonRpcLineTransport(input, output);
  const server = new LarkSdkJsonRpcServer(
    ctx,
    transport,
    config.maxTokensAsSuccess === undefined
      ? {}
      : { maxTokensAsSuccess: config.maxTokensAsSuccess },
  );
  let exitTask: Promise<void> | undefined;
  const disposeAndExit = (): Promise<void> => {
    exitTask ??= (async () => {
      await Promise.allSettled([transport.flush()]);
      await Promise.allSettled([rootFiber.dispose()]);
      exit(0);
    })();
    return exitTask;
  };

  transport.onRequest(async (method, params) => {
    if (method === 'initialize') await ctx.get('loader')?.await();
    const result = await server.handleRequest(method, params);
    if (method === 'shutdown') setImmediate(() => void disposeAndExit());
    return result;
  });
  ctx.effect(() => {
    transport.start();
    return async () => {
      await server.shutdown();
      transport.close();
    };
  }, 'jsonrpc.serve');
}
