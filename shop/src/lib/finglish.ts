/**
 * Persian → Finglish for category addresses: a pure, deterministic function. Words of the cosmetics / hygiene trade
 * come from a dictionary (ماسک = mask, مو = moo); any other word is transliterated letter by letter with the table
 * below. The result is lower-case a–z, 0–9 and single hyphens only. The numeric category code is NOT part of this
 * (urls.ts puts it last), and a category is found by that code alone — the words are for people and search engines.
 */

const WORDS: Readonly<Record<string, string>> = {
  ماسک: 'mask',
  مو: 'moo',
  صورت: 'soorat',
  کرم: 'krem',
  شامپو: 'shampoo',
  سرم: 'serom',
  تخصصی: 'takhasosi',
  عطر: 'attar',
  خوشبوکننده: 'khoshbo-konande',
  خوشبو: 'khoshbo',
  کننده: 'konande',
  بادی: 'body',
  میست: 'mist',
  مام: 'mam',
  رول: 'roll',
  کیت: 'kit',
  ناحیه: 'nahiye',
  چشم: 'cheshm',
  بدن: 'badan',
  ابزار: 'abzar',
  ابزارها: 'abzarha',
  سمپل: 'sample',
  ها: 'ha',
  روغن: 'roghan',
  لوسیون: 'lotion',
  ضد: 'zed',
  آفتاب: 'aftab',
  بدون: 'bedoon',
  رنگ: 'rang',
  رنگی: 'rangi',
  آرایشی: 'arayeshi',
  آرایش: 'arayesh',
  ریمل: 'rimel',
  سر: 'sar',
  کانسیلر: 'concealer',
  خط: 'khat',
  دهان: 'dahan',
  دندان: 'dandan',
  خمیر: 'khamir',
  شویه: 'shooye',
  شوینده: 'shooyande',
  پاک: 'pak',
  ژل: 'gel',
  شستشو: 'shostshoo',
  تونر: 'toner',
  میسلار: 'micellar',
  محلول: 'mahlool',
  دو: 'do',
  فازی: 'fazi',
  فوم: 'foam',
  صابون: 'sabon',
  بهداشتی: 'behdashti',
  پن: 'pan',
  مایع: 'maye',
  دستشویی: 'dastshooyi',
  فروش: 'foroosh',
  رژ: 'rooj',
  لب: 'lab',
  و: 'va',
  برای: 'baraye',
  با: 'ba',
  از: 'az',
  پوست: 'poost',
  دست: 'dast',
  پا: 'pa',
  ناخن: 'nakhon',
  لاک: 'lak',
  پودر: 'powder',
  پنکیک: 'pancake',
  کرمپودر: 'cream-powder',
  براش: 'brush',
  آبرسان: 'abresan',
  مرطوب: 'martoob',
  ضدچین: 'zedchin',
  ضدلک: 'zedlak',
  آنتی: 'anti',
  اکسیدان: 'oxidan',
  ویتامین: 'vitamin',
  کلاژن: 'collagen',
  آبی: 'abi',
  چرب: 'charb',
  خشک: 'khoshk',
  حساس: 'hassas',
  مردانه: 'mardane',
  زنانه: 'zanane',
  کودک: 'kodak',
  نوزاد: 'nozad',
  اصلاح: 'eslah',
  موی: 'mooye',
  ابرو: 'abroo',
  مژه: 'mozhe',
  سایه: 'saye',
  هایلایتر: 'highlighter',
  ست: 'set',
  پک: 'pack',
  مراقبت: 'moraghebat',
  آبرسانی: 'abresani',
  ضدآفتاب: 'zedaftab',
};

/** letter → Latin (short vowels are not written in Persian, so none are invented). */
const LETTERS: Readonly<Record<string, string>> = {
  ا: 'a',
  آ: 'a',
  ب: 'b',
  پ: 'p',
  ت: 't',
  ث: 's',
  ج: 'j',
  چ: 'ch',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'z',
  ر: 'r',
  ز: 'z',
  ژ: 'zh',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'z',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'gh',
  ک: 'k',
  گ: 'g',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  ء: '',
  ئ: 'e',
  ؤ: 'o',
  أ: 'a',
  ة: 'e',
};

const normalize = (s: string) =>
  s
    .normalize('NFC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟ]/g, '') // harakat
    .replace(/[‌‍]/g, ' ') // ZWNJ / ZWJ separate words
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

function transliterate(word: string): string {
  const chars = [...word];
  let out = '';
  chars.forEach((ch, i) => {
    if (ch === 'و') out += i === 0 ? 'v' : i === chars.length - 1 ? 'o' : 'o';
    else if (ch === 'ی') out += i === 0 ? 'y' : 'i';
    else if (ch in LETTERS) out += LETTERS[ch];
    else if (/[a-z0-9]/i.test(ch)) out += ch.toLowerCase();
    // anything else (a foreign symbol) is dropped
  });
  return out;
}

/** 'ماسک مو' → 'mask-moo'. Empty when nothing usable is left (the caller then uses the code alone). */
export function finglish(name: string): string {
  const words = normalize(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? transliterate(w));
  return words
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
}
