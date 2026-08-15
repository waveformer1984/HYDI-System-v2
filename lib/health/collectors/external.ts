import dns from 'dns';
import { promisify } from 'util';
import type { ExternalHealth, HealthCollector, HealthSnapshot } from '../types';

const resolveDns = promisify(dns.resolve);

export class ExternalHealthCollector implements HealthCollector {
  readonly name = 'external';

  async collect(): Promise<Partial<HealthSnapshot>> {
    const external = await this.buildExternalHealth();
    return { external };
  }

  private async buildExternalHealth(): Promise<ExternalHealth> {
    const network = await this.checkNetwork();
    const firebase = this.checkFirebase();
    const stripe = this.checkStripe();

    return {
      network,
      firebase,
      stripe,
    };
  }

  private async checkNetwork() {
    return {
      status: 'unavailable' as const,
      latencyMs: null,
      message: 'External network probing disabled in local-first mode',
      configured: false,
    };
  }

  private checkFirebase() {
    const configured = !!(
      process.env.FIREBASE_API_KEY ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    return {
      status: configured ? ('unknown' as const) : ('degraded' as const),
      configured,
      message: configured ? 'Firebase configured but not probed' : 'Firebase not configured',
    };
  }

  private checkStripe() {
    const configured = process.env.STRIPE_MODE === 'live' && !!process.env.STRIPE_SECRET_KEY;

    return {
      status: configured ? ('unknown' as const) : ('unavailable' as const),
      configured,
      message: configured
        ? 'Stripe live mode configured but not probed'
        : 'Stripe live mode not configured (mock mode)',
    };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), ms);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
