import 'server-only';
import QRCode from 'qrcode';

/**
 * The referral link as a QR code, made on the server (the `qrcode` package is imported nowhere in the client bundle). The quiet zone
 * is 4 modules (the QR standard's minimum) on every side, and the error correction is «M», so a printed banner scans reliably.
 */
const OPTIONS = { margin: 4, errorCorrectionLevel: 'M' as const };

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...OPTIONS, type: 'svg', color: { dark: '#1a1a1a', light: '#ffffff' } });
}

export async function qrPng(text: string, width = 900): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...OPTIONS, type: 'png', width, color: { dark: '#1a1a1a', light: '#ffffff' } });
}
