const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Raw body handling for Stripe signature verification
const getRawBody = require('raw-body');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe environment variables not configured');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      console.error('No orderId in session metadata');
      return res.status(400).json({ error: 'Missing orderId' });
    }

    try {
      const supabase = createClient(
        process.env.SHOP_SUPABASE_URL,
        process.env.SHOP_SUPABASE_SERVICE_KEY
      );

      const { data, error } = await supabase.rpc('shop_stripe_payment_success', {
        p_order_id: orderId,
        p_stripe_session_id: session.id,
      });

      if (error) {
        console.error('RPC error:', error);
        return res.status(500).json({ error: error.message });
      }

      console.log('Payment confirmed for order:', orderId, data);
    } catch (e) {
      console.error('Supabase error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(200).json({ received: true });
};

module.exports.config = {
  api: { bodyParser: false },
};
