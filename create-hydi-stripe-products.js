/**
 * Create HYDI Stripe Products and Prices
 * Creates three products: Starter ($99), Pro ($199), Enterprise ($299)
 */

const Stripe = require('stripe');
require('dotenv').config();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

class HYDIProductCreator {
  constructor() {
    this.products = [
      {
        name: 'HYDI Starter',
        description: 'Basic Supabase health monitoring — dashboard + email alerts on CRITICAL',
        price: 99.00,
        tier: 'starter',
        metadata: {
          hydi_tier: 'starter',
          vendor: 'ProtoForge'
        }
      },
      {
        name: 'HYDI Pro',
        description: 'Full HYDI — trends, auto-heal, escalation, Ursula agent, Slack alerts',
        price: 199.00,
        tier: 'pro',
        metadata: {
          hydi_tier: 'pro',
          vendor: 'ProtoForge'
        }
      },
      {
        name: 'HYDI Enterprise',
        description: 'White-label, API access, unlimited projects — resell HYDI to your clients',
        price: 299.00,
        tier: 'enterprise',
        metadata: {
          hydi_tier: 'enterprise',
          vendor: 'ProtoForge'
        }
      }
    ];
  }

  async createProduct(product) {
    try {
      console.log(`Creating product: ${product.name}`);
      
      // Create the product
      const stripeProduct = await stripe.products.create({
        name: product.name,
        description: product.description,
        metadata: product.metadata
      });

      console.log(`✓ Product created: ${stripeProduct.id}`);

      // Create recurring price
      const price = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: Math.round(product.price * 100), // Convert to cents
        currency: 'usd',
        recurring: {
          interval: 'month'
        },
        metadata: product.metadata
      });

      console.log(`✓ Price created: ${price.id}`);
      
      return {
        tier: product.tier,
        product_id: stripeProduct.id,
        price_id: price.id,
        price: product.price
      };
    } catch (error) {
      console.error(`Error creating ${product.name}:`, error.message);
      throw error;
    }
  }

  async createAllProducts() {
    console.log('=== Creating HYDI Stripe Products ===\n');
    
    const results = [];
    
    for (const product of this.products) {
      try {
        const result = await this.createProduct(product);
        results.push(result);
        console.log('');
      } catch (error) {
        console.error(`Failed to create ${product.name}: ${error.message}\n`);
      }
    }

    return results;
  }

  generateEnvVars(results) {
    const envVars = {};
    
    results.forEach(result => {
      const envName = `STRIPE_HYDI_${result.tier.toUpperCase()}_PRICE_ID`;
      envVars[envName] = result.price_id;
    });

    return envVars;
  }

  printResults(results) {
    console.log('=== HYDI PRODUCTS CREATED ===\n');
    
    results.forEach(result => {
      console.log(`${result.tier.toUpperCase()}:`);
      console.log(`  Product ID: ${result.product_id}`);
      console.log(`  Price ID:   ${result.price_id}`);
      console.log(`  Price:      $${result.price}/month`);
      console.log('');
    });

    const envVars = this.generateEnvVars(results);
    console.log('=== ENVIRONMENT VARIABLES ===\n');
    
    Object.entries(envVars).forEach(([key, value]) => {
      console.log(`${key}=${value}`);
    });
    
    console.log('\nAdd these to your .env file and Vercel environment variables.');
  }
}

// Run if called directly
if (require.main === module) {
  const creator = new HYDIProductCreator();
  
  creator.createAllProducts()
    .then(results => {
      if (results.length > 0) {
        creator.printResults(results);
        console.log('\n✅ All HYDI products created successfully!');
      } else {
        console.log('❌ No products were created.');
      }
    })
    .catch(error => {
      console.error('Failed to create products:', error.message);
      process.exit(1);
    });
}

module.exports = HYDIProductCreator;
