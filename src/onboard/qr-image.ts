import { toBuffer } from 'qrcode';

export interface QrRenderOptions {
  /** Output width in pixels (the QR stays square). */
  width?: number;
  /** Quiet-zone margin in modules. */
  margin?: number;
}

/**
 * Render a value (typically a Feishu / WeChat / QQ / deep-link URL) as a PNG
 * buffer so it can be uploaded as an image message into a Feishu session and
 * scanned with the corresponding IM app. The terminal path keeps using
 * `qrcode-terminal` for the out-of-band first bind; this is the image path used
 * everywhere a QR needs to be sent as a picture.
 */
export async function renderQrPng(value: string, options: QrRenderOptions = {}): Promise<Buffer> {
  return toBuffer(value, {
    type: 'png',
    width: options.width ?? 400,
    margin: options.margin ?? 2,
    errorCorrectionLevel: 'M',
  });
}
