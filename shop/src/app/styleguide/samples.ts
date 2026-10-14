// Sample Persian cosmetics data for /styleguide only (prices in RIAL, as stored).
import type { FooterProps, HeaderProps, ProductCardData, BottomNavItem } from '@/ui';

const base = { href: '/styleguide#cards', imageUrl: null } as const;

export const cards: Array<{ label: string; product: ProductCardData; state?: 'loading' | 'done' | 'fav' }> = [
  {
    label: 'تخفیف‌دار',
    product: {
      ...base,
      brand: 'تراست',
      name: 'سرم آبرسان هیالورونیک اسید ۲٪ حجم ۳۰ میلی‌لیتر',
      priceRial: 2_480_000,
      oldPriceRial: 3_100_000,
      stock: 'in',
      rating: 4.7,
      reviews: 412,
    },
  },
  {
    label: 'قیمت نمونه ۹٬۷۷۰٬۰۰۰ ریال',
    product: {
      ...base,
      brand: 'سرج',
      name: 'کرم ضدآفتاب رنگی SPF50 فاقد چربی مناسب پوست چرب و مختلط',
      priceRial: 9_770_000,
      stock: 'in',
      rating: 4.5,
      reviews: 87,
    },
  },
  {
    label: 'موجودی محدود + علاقه‌مندی',
    state: 'fav',
    product: {
      ...base,
      brand: 'سرج',
      name: 'کرم ضدآفتاب رنگی SPF50 فاقد چربی پوست چرب',
      priceRial: 1_895_000,
      oldPriceRial: 2_370_000,
      stock: 'limited',
    },
  },
  {
    label: 'ناموجود',
    product: {
      ...base,
      brand: 'لایف گارد',
      name: 'مام رول ضدتعریق مردانه ۴۸ ساعته',
      priceRial: 749_000,
      stock: 'out',
    },
  },
  {
    label: 'در حال افزودن',
    state: 'loading',
    product: {
      ...base,
      brand: 'تراست',
      name: 'ماسک موی آرگان و کراتین ۲۰۰ میلی‌لیتر',
      priceRial: 12_450_000,
      stock: 'in',
    },
  },
  {
    label: 'افزوده شد',
    state: 'done',
    product: {
      ...base,
      brand: 'تراست',
      name: 'شامپو تقویت‌کننده کراتینه ۴۰۰ میلی‌لیتر',
      priceRial: 1_260_000,
      stock: 'in',
    },
  },
];

export const header: HeaderProps = {
  brand: { name: 'آوینا', latin: 'AVINA BEAUTY', homeHref: '/styleguide' },
  categories: [
    { label: 'مراقبت پوست', href: '/c/skin', current: true },
    { label: 'آرایش', href: '/c/makeup' },
    { label: 'عطر و ادکلن', href: '/c/scent' },
    { label: 'مراقبت مو', href: '/c/hair' },
    { label: 'مراقبت بدن', href: '/c/body' },
    { label: 'بهداشت دهان و دندان', href: '/c/oral' },
    { label: 'برندها', href: '/brands' },
    { label: 'پیشنهاد شگفت‌انگیز', href: '/offers', highlight: true },
  ],
  allCategoriesHref: '/categories',
  cartCount: 3,
  walletRial: 1_200_000,
  freeShippingFromRial: 9_990_000,
  supportPhone: '021-91004500',
  deliverTo: 'تهران',
  links: {
    cart: '/cart',
    account: '/account',
    wallet: '/account/wallet',
    login: '/login',
    orders: '/account/orders',
    favorites: '/account/favorites',
  },
};

export const bottomNav: BottomNavItem[] = [
  { icon: 'home', label: 'خانه', href: '/styleguide', current: true },
  { icon: 'grid_view', label: 'دسته‌ها', href: '/categories' },
  { icon: 'search', label: 'جست‌وجو', href: '/search' },
  { icon: 'shopping_bag', label: 'سبد', href: '/cart', count: 3 },
  { icon: 'person', label: 'حساب', href: '/account' },
];

export const footer: Omit<FooterProps, 'seals'> = {
  brandName: 'آوینا',
  about:
    'فروشگاه تخصصی محصولات آرایشی، بهداشتی و مراقبت شخصی؛ تمام کالاها مستقیم از تأمین‌کننده رسمی و با ضمانت اصالت ارسال می‌شوند.',
  trust: [
    { icon: 'verified', title: 'ضمانت اصالت کالا', sub: 'مستقیم از تأمین‌کننده رسمی' },
    { icon: 'assignment_return', title: '۷ روز ضمانت بازگشت', sub: 'بدون پرسش، برای کالای باز نشده' },
    { icon: 'lock', title: 'پرداخت امن', sub: 'درگاه شاپرک و کیف پول' },
    { icon: 'local_shipping', title: 'ارسال به سراسر ایران', sub: 'تهران: تحویل فردا' },
    { icon: 'support_agent', title: 'پشتیبانی انسانی', sub: 'گفت‌وگوی زنده، هر روز' },
  ],
  columns: [
    {
      title: 'راهنمای خرید',
      links: [
        { label: 'نحوه ثبت سفارش', href: '/help/order' },
        { label: 'روش‌های ارسال و هزینه', href: '/help/shipping' },
        { label: 'شیوه‌های پرداخت', href: '/help/payment' },
        { label: 'پیگیری سفارش', href: '/account/orders' },
      ],
    },
    {
      title: 'قوانین و مقررات',
      links: [
        { label: 'شرایط بازگشت کالا', href: '/legal/returns' },
        { label: 'حریم خصوصی', href: '/legal/privacy' },
        { label: 'شرایط استفاده', href: '/legal/terms' },
        { label: 'قوانین کیف پول', href: '/legal/wallet' },
      ],
    },
    {
      title: 'آوینا',
      links: [
        { label: 'درباره ما', href: '/about' },
        { label: 'تماس با ما', href: '/contact' },
        { label: 'مجله آوینا', href: '/blog' },
      ],
    },
  ],
  contact: {
    phone: '021-91004500',
    hours: 'هر روز ۹ تا ۲۱',
    email: 'support@example.ir',
    address: 'تهران، خیابان ولیعصر، پلاک ۲۴۱۰',
  },
  social: [
    { label: 'اینستاگرام', href: 'https://instagram.com/' },
    { label: 'تلگرام', href: 'https://t.me/' },
    { label: 'آپارات', href: 'https://aparat.com/' },
  ],
  copyright: '© ۱۴۰۵ — تمامی حقوق این وب‌سایت متعلق به فروشگاه اینترنتی آوینا است.',
};
