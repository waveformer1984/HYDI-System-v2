const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function testStripeConnection() {
  try {
    console.log('Testing Stripe connection with new key...');
    
    // Test balance retrieval
    const balance = await stripe.balance.retrieve();
    console.log('✅ Stripe connection successful');
    console.log('Available balance:', balance.available[0].amount / 100, balance.available[0].currency);
    
    // Test account info
    const account = await stripe.account.retrieve();
    console.log('Account ID:', account.id);
    console.log('Account country:', account.country);
    
    console.log('✅ New Stripe key is working correctly');
    
  } catch (error) {
    console.error('❌ Stripe connection failed:', error.message);
    console.error('Type:', error.type);
    console.error('Code:', error.code);
  }
}

testStripeConnection();
