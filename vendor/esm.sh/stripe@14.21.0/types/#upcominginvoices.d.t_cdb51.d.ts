declare module 'https://esm.sh/stripe@14.21.0/types/index.d.ts' {
  namespace Stripe {
    type UpcomingInvoice = Omit<Stripe.Invoice, 'id'>;
  }
}
