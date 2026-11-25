'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui';
import s from './admin-blog.module.css';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Word-like WYSIWYG Rich Text Editor tailored for Avina Blog:
 * - Headings (H2/H3/H4), Paragraph, Blockquote
 * - Bold, Italic, Underline, Strikethrough
 * - RTL/Center/LTR alignment, Bullet & Numbered Lists, Divider
 * - Insert/Edit/Remove Links (internal & external, new tab, nofollow)
 * - Upload & Insert standardized inline images (with Alt, Caption & optional Link)
 * - HTML Source toggle
 */
export function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextHtml: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const imgFileRef = useRef<HTMLInputElement | null>(null);

  const [sourceMode, setSourceMode] = useState(false);
  const [popover, setPopover] = useState<'none' | 'link' | 'image'>('none');

  // Link popover fields
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkBlank, setLinkBlank] = useState(false);
  const [linkNofollow, setLinkNofollow] = useState(false);

  // Image popover fields
  const [imgUrl, setImgUrl] = useState('');
  const [imgAlt, setImgAlt] = useState('');
  const [imgCaption, setImgCaption] = useState('');
  const [imgLink, setImgLink] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  // Sync external initial value into contentEditable only when switching posts or leaving source mode
  useEffect(() => {
    if (!sourceMode && editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value, sourceMode]);

  const emit = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };

  const exec = (cmd: string, val?: string) => {
    if (sourceMode) return;
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    emit();
  };

  const openLinkPopover = () => {
    saveSelection();
    const sel = window.getSelection();
    setLinkText(sel?.toString() ?? '');
    setLinkUrl('');
    setLinkBlank(false);
    setLinkNofollow(false);
    setPopover((p) => (p === 'link' ? 'none' : 'link'));
  };

  const insertLink = () => {
    const href = linkUrl.trim();
    if (!href) return;
    const safeHref = href.startsWith('/') || /^https?:\/\//i.test(href) ? href : `https://${href}`;
    const rels = new Set<string>();
    if (linkBlank) {
      rels.add('noopener');
      rels.add('noreferrer');
    }
    if (linkNofollow) rels.add('nofollow');
    const relAttr = rels.size ? ` rel="${Array.from(rels).join(' ')}"` : '';
    const targetAttr = linkBlank ? ' target="_blank"' : '';
    const label = linkText.trim() || safeHref;

    restoreSelection();
    const html = `<a href="${escapeHtml(safeHref)}"${targetAttr}${relAttr}>${escapeHtml(label)}</a>`;
    document.execCommand('insertHTML', false, html);
    emit();
    setPopover('none');
  };

  const openImagePopover = () => {
    saveSelection();
    setImgUrl('');
    setImgAlt('');
    setImgCaption('');
    setImgLink('');
    setUploadErr(null);
    setPopover((p) => (p === 'image' ? 'none' : 'image'));
  };

  const handleImageFile = async (file: File) => {
    setUploadingImg(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/blog/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setUploadErr(data.message || 'آپلود تصویر ناموفق بود.');
        return;
      }
      setImgUrl(data.url);
    } catch {
      setUploadErr('خطا در ارتباط با سرور.');
    } finally {
      setUploadingImg(false);
    }
  };

  const insertImage = () => {
    const src = imgUrl.trim();
    if (!src) return;
    const alt = imgAlt.trim();
    const cap = imgCaption.trim();
    const href = imgLink.trim();

    const imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
    const wrappedImg = href
      ? `<a href="${escapeHtml(href.startsWith('/') || /^https?:\/\//i.test(href) ? href : `https://${href}`)}" target="_blank" rel="noopener noreferrer">${imgTag}</a>`
      : imgTag;
    const figCaption = cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : '';
    const html = `<figure class="av-blog-figure">${wrappedImg}${figCaption}</figure><p><br /></p>`;

    restoreSelection();
    document.execCommand('insertHTML', false, html);
    emit();
    setPopover('none');
  };

  return (
    <div className={s.rteWrap} data-blog-rte>
      <div className={s.rteToolbar} role="toolbar" aria-label="نوار ابزار ویرایشگر متن">
        <select
          className={s.rteSelect}
          disabled={sourceMode}
          aria-label="نوع تیتر یا پاراگراف"
          defaultValue="p"
          onChange={(e) => {
            exec('formatBlock', `<${e.target.value}>`);
            e.target.value = 'p';
          }}
        >
          <option value="p">پاراگراف (عادی)</option>
          <option value="h2">تیتر ۲ (H2)</option>
          <option value="h3">تیتر ۳ (H3)</option>
          <option value="h4">تیتر ۴ (H4)</option>
          <option value="blockquote">نقل‌قول برجسته</option>
        </select>

        <span className={s.rteSep} />

        <button type="button" className={s.rteBtn} title="ضخیم (Bold)" onClick={() => exec('bold')} disabled={sourceMode}>
          <strong>B</strong>
        </button>
        <button type="button" className={s.rteBtn} title="مورب (Italic)" onClick={() => exec('italic')} disabled={sourceMode}>
          <em>I</em>
        </button>
        <button type="button" className={s.rteBtn} title="زیرخط (Underline)" onClick={() => exec('underline')} disabled={sourceMode}>
          <u>U</u>
        </button>
        <button type="button" className={s.rteBtn} title="خط‌خورده" onClick={() => exec('strikeThrough')} disabled={sourceMode}>
          <s>S</s>
        </button>

        <span className={s.rteSep} />

        <button type="button" className={s.rteBtn} title="راست‌چین" onClick={() => exec('justifyRight')} disabled={sourceMode}>
          راست
        </button>
        <button type="button" className={s.rteBtn} title="وسط‌چین" onClick={() => exec('justifyCenter')} disabled={sourceMode}>
          وسط
        </button>
        <button type="button" className={s.rteBtn} title="چپ‌چین" onClick={() => exec('justifyLeft')} disabled={sourceMode}>
          چپ
        </button>

        <span className={s.rteSep} />

        <button type="button" className={s.rteBtn} title="فهرست نقطه‌ای" onClick={() => exec('insertUnorderedList')} disabled={sourceMode}>
          • فهرست
        </button>
        <button type="button" className={s.rteBtn} title="فهرست شماره‌دار" onClick={() => exec('insertOrderedList')} disabled={sourceMode}>
          ۱. فهرست
        </button>
        <button type="button" className={s.rteBtn} title="خط جداکننده" onClick={() => exec('insertHorizontalRule')} disabled={sourceMode}>
          — خط
        </button>

        <span className={s.rteSep} />

        <button
          type="button"
          className={`${s.rteBtn} ${popover === 'link' ? s.rteBtnActive : ''}`}
          title="افزودن لینک"
          onClick={openLinkPopover}
          disabled={sourceMode}
          data-rte-link-btn
        >
          🔗 لینک
        </button>
        <button type="button" className={s.rteBtn} title="حذف لینک" onClick={() => exec('unlink')} disabled={sourceMode}>
          حذف لینک
        </button>
        <button
          type="button"
          className={`${s.rteBtn} ${popover === 'image' ? s.rteBtnActive : ''}`}
          title="درج تصویر در میانه متن"
          onClick={openImagePopover}
          disabled={sourceMode}
          data-rte-image-btn
        >
          🖼 درج تصویر
        </button>

        <span className={s.rteSep} />

        <button type="button" className={s.rteBtn} title="بازگشت (Undo)" onClick={() => exec('undo')} disabled={sourceMode}>
          ↶
        </button>
        <button type="button" className={s.rteBtn} title="تکرار (Redo)" onClick={() => exec('redo')} disabled={sourceMode}>
          ↷
        </button>
        <button
          type="button"
          className={`${s.rteBtn} ${sourceMode ? s.rteBtnActive : ''}`}
          title="نمایش کد HTML"
          onClick={() => {
            setPopover('none');
            setSourceMode((v) => !v);
          }}
        >
          {'</>'} HTML
        </button>
      </div>

      {/* Insert Link Popover */}
      {popover === 'link' && !sourceMode && (
        <div className={s.rtePopover}>
          <strong style={{ fontSize: 13 }}>درج لینک در متن مقاله</strong>
          <div className={s.fieldGrid}>
            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>آدرس لینک (داخلی یا خارجی)</label>
              <input
                className={`${s.input} ${s.ltr}`}
                placeholder="/shop/packs یا https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>متن نمایشی لینک</label>
              <input
                className={s.input}
                placeholder="مثلاً: مشاهده پک پوست چرب"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, fontSize: 12.5 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={linkBlank} onChange={(e) => setLinkBlank(e.target.checked)} />
              باز شدن در تب جدید
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={linkNofollow} onChange={(e) => setLinkNofollow(e.target.checked)} />
              لینک nofollow
            </label>
            <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
              <Button type="button" size="sm" onClick={insertLink}>
                درج لینک
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPopover('none')}>
                انصراف
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Insert Image Popover */}
      {popover === 'image' && !sourceMode && (
        <div className={s.rtePopover}>
          <strong style={{ fontSize: 13 }}>درج تصویر در میانه متن (نمایش با ابعاد استاندارد در همه دستگاه‌ها)</strong>
          <input
            ref={imgFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void handleImageFile(f);
            }}
          />
          {uploadErr && <span style={{ color: 'var(--color-danger)', fontSize: 12, fontWeight: 700 }}>{uploadErr}</span>}
          <div className={s.fieldGrid}>
            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>آپلود تصویر یا وارد کردن لینک</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className={`${s.input} ${s.ltr}`}
                  placeholder="/api/blog/media/... یا https://..."
                  value={imgUrl}
                  onChange={(e) => setImgUrl(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={uploadingImg}
                  loadingText="آپلود..."
                  onClick={() => imgFileRef.current?.click()}
                >
                  آپلود
                </Button>
              </div>
            </div>
            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>متن جایگزین (Alt — مهم برای سئو)</label>
              <input
                className={s.input}
                placeholder="توضیح کوتاه تصویر"
                value={imgAlt}
                onChange={(e) => setImgAlt(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>زیرنویس تصویر (اختیاری)</label>
              <input
                className={s.input}
                placeholder="توضیح زیر تصویر"
                value={imgCaption}
                onChange={(e) => setImgCaption(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>لینک روی تصویر (اختیاری)</label>
              <input
                className={`${s.input} ${s.ltr}`}
                placeholder="/shop/product/..."
                value={imgLink}
                onChange={(e) => setImgLink(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" size="sm" onClick={insertImage} disabled={!imgUrl.trim()}>
              درج تصویر در متن
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPopover('none')}>
              انصراف
            </Button>
          </div>
        </div>
      )}

      {sourceMode ? (
        <textarea
          className={s.rteSource}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="کد HTML مقاله"
        />
      ) : (
        <div
          ref={editorRef}
          className={s.rteCanvas}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="متن مقاله را اینجا بنویسید... از نوار ابزار بالا برای تیتربندی (H2/H3)، لینک‌دهی، لیست‌ها و درج تصویر استفاده کنید."
          onInput={emit}
          onBlur={saveSelection}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          data-blog-rte-canvas
        />
      )}
    </div>
  );
}
