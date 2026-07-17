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
    const start = Date.now();
    try {
      await this.withTimeout(resolveDns('cloudflare.com'), 3000);
      const latency = Date.now() - start;
      return { status: 'healthy' as const, latencyMs: latency, message: 'External DNS reachable' };
    } catch (error) {
      return {
        status: 'unavailable' as const,
        latencyMs: Date.now() - start,
        message: 'External network unreachable',
        error: error instanceof Error ? error.message : 'DNS resolution failed',
      };
    }
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
    const configured = !!process.env.STRIPE_SECRET_KEY;

    return {
      status: configured ? ('unknown' as const) : ('degraded' as const),
      configured,
      message: configured ? 'Stripe configured but not probed' : 'Stripe secret key not configured',
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
