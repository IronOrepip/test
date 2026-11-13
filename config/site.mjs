// Single place for site, company, language, region and shipping settings.
// Used by the build script and by the Worker. No secrets live here.

export const site = {
  name: 'NOVA',
  url: 'https://novaporto.eu',
  defaultLang: 'en',
  // Adding a language: add one line here, a locales/<code>.json file, translated product text
  // in the seed file, and the email strings inside that locale file.
  languages: [
    { code: 'en', prefix: '', locale: 'en-GB', hreflang: 'en', label: 'English' }
    // Phase 2: { code: 'it', prefix: '/it', locale: 'it-IT', hreflang: 'it', label: 'Italiano' },
    // Phase 2: { code: 'ru', prefix: '/ru', locale: 'ru-RU', hreflang: 'ru', label: 'Русский' }
  ],
  gtmId: 'GTM-KTDL2RB7',
  emails: {
    info: 'info@novaporto.eu',
    hello: 'hello@novaporto.eu',
    orders: 'orders@novaporto.eu',
    invoices: 'invoices@novaporto.eu',
    // Sending subdomain at the email provider. Reply-To is always the Microsoft 365 address above.
    sendingDomain: 'mail.novaporto.eu'
  },
  // TODO: fill in once the company is registered. Do not invent these.
  company: {
    legalName: 'TODO: legal name',
    address: 'TODO: registered address',
    vatNumber: 'TODO: VAT number'
  },
  social: {
    linkedin: 'https://www.linkedin.com/company/novaporto/',
    x: 'https://x.com/novaportoeu'
  },
  categories: ['nfc-cards', 'nfc-stands', 'nfc-stickers', 'souvenirs', 'digital'],
  checkout: {
    sessionMinutes: 30, // Stripe Checkout session lifetime
    reservationMinutes: 35, // stock hold; slightly longer than the session
    asyncReservationDays: 14, // hold for delayed payment methods (for example SEPA Debit)
    orderPrefix: 'NOVA-'
  },
  reviewRequestDays: 7
};

const EU27 = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

// A region is sold to only when `enabled` is true AND its payment provider is configured
// (the Worker checks the provider's keys at request time).
export const regions = {
  eu_eea: {
    enabled: true,
    provider: 'stripe',
    currency: 'EUR',
    countries: [...EU27, 'NO', 'IS', 'LI'],
    shipping: { amount: 900, minDays: 3, maxDays: 7 }, // TODO: confirm amount (cents, excluding VAT) and delivery time
    tax: 'stripe_tax'
  },
  uk: {
    enabled: false, // needs UK VAT registration and customs data on every product first
    provider: 'stripe',
    currency: 'EUR',
    countries: ['GB'],
    shipping: { amount: 1900, minDays: 5, maxDays: 10 }, // TODO: confirm
    tax: 'stripe_tax'
  },
  ru: {
    enabled: false, // phase 2: switch on once the Russian acquirer's keys are set
    provider: 'yookassa',
    currency: 'RUB',
    countries: ['RU'],
    shipping: { amount: 0, minDays: 0, maxDays: 0 }, // TODO: confirm carrier, price and delivery time
    tax: 'TODO: confirm with my accountant'
  }
};

export function regionForCountry(country) {
  const code = String(country || '').toUpperCase();
  for (const [id, region] of Object.entries(regions)) {
    if (region.countries.includes(code)) return { id, ...region };
  }
  return null;
}

export function enabledRegions() {
  return Object.entries(regions).filter(([, r]) => r.enabled).map(([id, r]) => ({ id, ...r }));
}

export function enabledCountries() {
  return enabledRegions().flatMap((r) => r.countries);
}

export function langByCode(code) {
  return site.languages.find((l) => l.code === code) || site.languages[0];
}
