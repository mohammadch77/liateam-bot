'use client';

import Image from 'next/image';
import { useState } from 'react';
import { toFaDigits } from '@/lib/format/number';
import { Button } from '@/ui';
import b from './business-card.module.css';

type BusinessCardProps = {
  brandName: string;
  sellerName: string;
  phone: string;
  code: string;
  link: string;
  tierTitle?: string | null;
};

/** Wraps raw JPEG bytes into a spec-compliant single-page PDF 1.4 binary (252×144 pt = 89×51 mm business card). */
function buildPdfFromJpeg(jpegBytes: Uint8Array, imgWidth: number, imgHeight: number): Uint8Array {
  const pageW = 252; // 3.5 in (88.9 mm)
  const pageH = 144; // 2.0 in (50.8 mm)
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let cursor = 0;

  const pushStr = (str: string) => {
    const buf = enc.encode(str);
    chunks.push(buf);
    cursor += buf.length;
  };
  const pushBytes = (buf: Uint8Array) => {
    chunks.push(buf);
    cursor += buf.length;
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // 1: Catalog
  offsets.push(cursor);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  offsets.push(cursor);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // 3: Page
  offsets.push(cursor);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  // 4: JPEG Image XObject
  offsets.push(cursor);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  );
  pushBytes(jpegBytes);
  pushStr('\nendstream\nendobj\n');

  // 5: Page Content Stream
  const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(cursor);
  pushStr(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

  // xref table
  const xrefPos = cursor;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(cursor);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('QR image failed to load'));
    img.src = src;
  });
}

export function BusinessCard({ brandName, sellerName, phone, code, link, tierTitle }: BusinessCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const displayName = sellerName.trim() || `همکار فروش ${brandName}`;
  const displayPhone = toFaDigits(phone);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    setErr(null);
    try {
      await document.fonts.ready;
      const W = 1050;
      const H = 600;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');

      const fontFamily = getComputedStyle(document.body).fontFamily || 'Vazirmatn, sans-serif';

      // Rich luxury berry-plum background gradient
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#4B0D27');
      bg.addColorStop(0.55, '#8A1C4A');
      bg.addColorStop(1, '#6E143A');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Ambient rose-gold glow
      const glow = ctx.createRadialGradient(W * 0.85, H * 0.12, 10, W * 0.85, H * 0.12, 340);
      glow.addColorStop(0, 'rgba(226, 185, 166, 0.25)');
      glow.addColorStop(1, 'rgba(226, 185, 166, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Subtle inner rose-gold border frame
      drawRoundedRect(ctx, 22, 22, W - 44, H - 44, 24);
      ctx.strokeStyle = 'rgba(226, 185, 166, 0.42)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Bottom rose-gold accent bar
      const barGrad = ctx.createLinearGradient(120, 0, W - 120, 0);
      barGrad.addColorStop(0, 'rgba(226, 185, 166, 0)');
      barGrad.addColorStop(0.5, '#E2B9A6');
      barGrad.addColorStop(1, 'rgba(226, 185, 166, 0)');
      ctx.fillStyle = barGrad;
      ctx.fillRect(100, H - 10, W - 200, 6);

      // Left side: White rounded QR card
      const qrBoxX = 64;
      const qrBoxY = 128;
      const qrBoxSize = 310;
      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 24);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      const qrImg = await loadImage('/account/affiliate/qr?f=png');
      ctx.drawImage(qrImg, qrBoxX + 16, qrBoxY + 16, qrBoxSize - 32, qrBoxSize - 32);

      // QR caption
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F3D5C8';
      ctx.font = `700 22px ${fontFamily}`;
      ctx.fillText('اسکن کنید و با تخفیف بخرید', qrBoxX + qrBoxSize / 2, qrBoxY + qrBoxSize + 42);

      // Right side: Brand, Role, Seller Info, Referral Code, Link
      const rightX = W - 64;
      ctx.textAlign = 'right';

      // Brand wordmark
      ctx.direction = 'ltr';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 56px ${fontFamily}`;
      ctx.fillText(`${brandName}.`, rightX, 128);

      // Role pill
      ctx.direction = 'rtl';
      const roleLabel = tierTitle ? `همکار رسمی فروش · سطح ${tierTitle}` : 'همکار رسمی فروش';
      ctx.font = `700 22px ${fontFamily}`;
      const pillW = Math.min(460, ctx.measureText(roleLabel).width + 44);
      drawRoundedRect(ctx, rightX - pillW, 152, pillW, 44, 22);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 185, 166, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#F8E4DB';
      ctx.textAlign = 'center';
      ctx.fillText(roleLabel, rightX - pillW / 2, 182);

      // Seller Name & Phone
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 40px ${fontFamily}`;
      ctx.fillText(displayName, rightX, 272);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = `600 26px ${fontFamily}`;
      ctx.fillText(`شماره تماس: ${displayPhone}`, rightX, 322);

      // Referral Code Box
      const codeBoxW = 360;
      const codeBoxH = 66;
      const codeBoxX = rightX - codeBoxW;
      const codeBoxY = 366;
      drawRoundedRect(ctx, codeBoxX, codeBoxY, codeBoxW, codeBoxH, 16);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 185, 166, 0.48)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#F3D5C8';
      ctx.font = `700 24px ${fontFamily}`;
      ctx.fillText('کد معرف:', rightX - 20, codeBoxY + 42);

      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 32px ${fontFamily}`;
      ctx.fillText(code, codeBoxX + 22, codeBoxY + 44);

      // Link footer
      ctx.direction = 'ltr';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.font = `500 20px ${fontFamily}`;
      ctx.fillText(link, rightX, 492);

      // Convert canvas to JPEG bytes -> PDF binary
      const dataUrl = canvas.toDataURL('image/jpeg', 0.96);
      const base64 = dataUrl.split(',')[1]!;
      const binStr = atob(base64);
      const jpegBytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) jpegBytes[i] = binStr.charCodeAt(i);

      const pdfBytes = buildPdfFromJpeg(jpegBytes, W, H);
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `avina-business-card-${code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setErr('ساخت فایل PDF انجام نشد. لطفاً دوباره تلاش کنید.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={b.wrapper} data-affiliate-business-card>
      <div className={b.previewStage}>
        <article className={b.card} aria-label="کارت ویزیت دیجیتال همکار فروش">
          <div className={b.info}>
            <div className={b.brandRow}>
              <span className={b.brand}>
                {brandName}
                <span className={b.dot}>.</span>
              </span>
              <span className={b.roleBadge}>
                {tierTitle ? `همکار فروش · سطح ${tierTitle}` : 'همکار رسمی فروش'}
              </span>
            </div>

            <div className={b.sellerBlock}>
              <span className={b.sellerName}>{displayName}</span>
              <span className={b.sellerMeta} dir="ltr" style={{ alignSelf: 'flex-start' }}>
                {displayPhone}
              </span>
            </div>

            <div className={b.codeBox}>
              <span className={b.codeLabel}>کد معرف:</span>
              <span className={b.codeVal}>{code}</span>
            </div>

            <span className={b.linkLine}>{link}</span>
          </div>

          <div className={b.qrColumn}>
            <div className={b.qrFrame}>
              <Image
                src="/account/affiliate/qr"
                alt="QR کد لینک معرفی شما"
                width={126}
                height={126}
                unoptimized
                data-qr
              />
            </div>
            <span className={b.qrCaption}>اسکن برای خرید</span>
          </div>
        </article>
      </div>

      {err && <p className={b.error}>{err}</p>}

      <div className={b.actions}>
        <Button
          type="button"
          onClick={handleDownloadPdf}
          loading={downloading}
          loadingText="در حال ساخت PDF…"
          icon="assignment_return"
          data-card-pdf
        >
          دریافت فایل PDF کارت ویزیت
        </Button>
        <Button
          href="/account/affiliate/qr?f=svg&download=1"
          variant="outline"
          prefetch={false}
          data-qr-svg
        >
          دانلود QR (SVG)
        </Button>
        <Button
          href="/account/affiliate/qr?f=png&download=1"
          variant="outline"
          prefetch={false}
          data-qr-png
        >
          دانلود QR (PNG)
        </Button>
        <Button href="/account/affiliate/banner" variant="outline" data-qr-banner>
          بنر چاپی (A5)
        </Button>
      </div>
    </div>
  );
}
