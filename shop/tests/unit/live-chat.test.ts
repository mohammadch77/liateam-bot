import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFileSize,
  linkifyParts,
  needsPreChat,
  normalizeIranMobile,
  sanitizeChatText,
  validatePreChatValues,
  type ChatPreChatField,
} from '../../src/lib/live-chat/types.ts';

const defaultFields: ChatPreChatField[] = [
  { key: 'name', enabled: true, required: true, sortOrder: 1 },
  { key: 'mobile', enabled: true, required: true, sortOrder: 2 },
  { key: 'email', enabled: false, required: false, sortOrder: 3 },
];

test('needsPreChat skips for identified Avina users and returning conversations', () => {
  assert.equal(
    needsPreChat({
      fields: defaultFields,
      visitor: null,
      isIdentifiedUser: true,
      submitted: false,
      hasConversation: false,
    }),
    false,
  );

  assert.equal(
    needsPreChat({
      fields: defaultFields,
      visitor: null,
      isIdentifiedUser: false,
      submitted: false,
      hasConversation: true,
    }),
    false,
  );
});

test('needsPreChat requires form when required fields are missing and hides when filled', () => {
  assert.equal(
    needsPreChat({
      fields: defaultFields,
      visitor: { name: 'سارا', mobile: null },
      isIdentifiedUser: false,
      submitted: false,
      hasConversation: false,
    }),
    true,
  );

  assert.equal(
    needsPreChat({
      fields: defaultFields,
      visitor: { name: 'سارا', mobile: '09123456789' },
      isIdentifiedUser: false,
      submitted: false,
      hasConversation: false,
    }),
    false,
  );
});

test('validatePreChatValues validates Iranian mobile with Persian digits and email', () => {
  const fieldsWithEmail: ChatPreChatField[] = [
    { key: 'name', enabled: true, required: true, sortOrder: 1 },
    { key: 'mobile', enabled: true, required: true, sortOrder: 2 },
    { key: 'email', enabled: true, required: false, sortOrder: 3 },
  ];

  const bad = validatePreChatValues(fieldsWithEmail, {
    name: 'س',
    mobile: '12345',
    email: 'not-an-email',
  });
  assert.ok(bad.name);
  assert.ok(bad.mobile);
  assert.ok(bad.email);

  const good = validatePreChatValues(fieldsWithEmail, {
    name: 'سارا محمدی',
    mobile: '۰۹۱۲۳۴۵۶۷۸۹',
    email: 'sara@example.com',
  });
  assert.deepEqual(good, {});
  assert.equal(normalizeIranMobile('۰۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789');
  assert.equal(normalizeIranMobile('+98 912-345-6789'), '09123456789');
});

test('sanitizeChatText strips ASCII control chars and Unicode BiDi overrides', () => {
  const dirty = 'سلام \u202E<script>\u0007 دنیا';
  assert.equal(sanitizeChatText(dirty), 'سلام <script> دنیا');
});

test('linkifyParts extracts only http/https links safely without javascript: URLs', () => {
  const parts = linkifyParts('اینجا ببین: https://avina.ir/shop/123. و javascript:alert(1)');
  assert.equal(parts.length, 3);
  assert.equal(parts[1]?.kind, 'link');
  if (parts[1]?.kind === 'link') {
    assert.equal(parts[1].href, 'https://avina.ir/shop/123');
  }
  assert.equal(parts[2]?.kind, 'text');
});

test('formatFileSize formats KB and MB cleanly', () => {
  assert.equal(formatFileSize(512), '1 KB');
  assert.equal(formatFileSize(2048), '2 KB');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB');
});
