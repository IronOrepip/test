// One small interface for every payment provider: createCheckout, verifyWebhook, refund, getStatus.
// Each region names its provider in config/site.mjs. Orders store payment_provider, currency and
// the provider's ids, so orders, emails, stock and the admin page work the same for all of them.
import { stripeProvider } from './stripe.js';

// Phase 2: the Russian acquirer (YooKassa by default) for MIR, Yandex Pay and SBP.
const yookassaProvider = {
  id: 'yookassa',
  isConfigured: (env) => Boolean(env.RU_SHOP_ID && env.RU_SECRET_KEY) && false, // not built yet: never reports ready
  isTestMode: () => true,
  async createCheckout() { throw new Error('yookassa provider is built in phase 2'); },
  async verifyWebhook() { return null; },
  async getStatus() { throw new Error('yookassa provider is built in phase 2'); },
  async refund() { throw new Error('yookassa provider is built in phase 2'); }
};

export const providers = { stripe: stripeProvider, yookassa: yookassaProvider };
export const providerFor = (region) => providers[region.provider];
