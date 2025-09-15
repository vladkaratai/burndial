import { serve } from "https://deno.land/std@0.190.0/http/server.ts  ";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0  ";
import Stripe from "npm:stripe@^14.0.0";
const stripe = new Stripe(Deno.env.get('STRIPE_TEST_SECRET_KEY'), {
  apiVersion: '2024-06-20'
});
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
serve(async (req)=>{
  console.log('=== NEW REQUEST ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', [
    ...req.headers.entries()
  ]);
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const signature = req.headers.get("stripe-signature");
    console.log('Stripe signature header:', signature);
    let body;
    try {
      body = await req.text();
    } catch (err) {
      return new Response(JSON.stringify({
        error: "Failed to read request body"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const webhookSigningSecret = 'secret';
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSigningSecret);
    } catch (err) {
      return new Response(JSON.stringify({
        error: `Webhook signature verification failed: ${err.message}`
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log('🔔 Received event (unverified):', event.type);
    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { data: existing, error: existingError } = await supabase.from('webhook_events').select('id').eq('event_id', `stripe:${session.id}`).single();
      if (existingError && existingError.code !== 'PGRST116') {
        console.error('❌ Database error when checking existing event:', existingError);
        return new Response('Database error', {
          status: 500
        });
      }
      if (existing) {
        console.log('✅ Already processed:', session.id);
        return new Response('Already processed', {
          status: 200
        });
      }
      const companyId = session.metadata?.company_id;
      if (!companyId) {
        console.error('❌ Missing company_id in session metadata');
        return new Response('Missing company_id', {
          status: 400
        });
      }
      const { data: company, error: companyErr } = await supabase.from('companies').select('stripe_account_id, debt_cents').eq('id', companyId).single();
      if (companyErr || !company?.stripe_account_id) {
        console.error('❌ Company not found or missing stripe_account_id:', companyErr?.message || 'Company not found');
        return new Response('Company not found', {
          status: 400
        });
      }
      let paymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
      } catch (err) {
        console.error('❌ Failed to retrieve payment intent:', err.message);
        return new Response('Failed to retrieve payment intent', {
          status: 500
        });
      }
      const phoneHash = session.metadata?.phone_hash;
      const grossAmount = session.amount_total;
      const platformFeeCents = parseInt(paymentIntent.metadata?.platform_fee_cents || '0', 10);
      const netToBusiness = parseInt(paymentIntent.metadata?.net_to_business_cents || '0', 10);
      const currentDebt = company.debt_cents || 0;
      console.log('📊 Processing checkout session:', {
        session_id: session.id,
        company_id: companyId,
        gross: grossAmount,
        fee: platformFeeCents,
        net: netToBusiness,
        current_debt: currentDebt
      });
      if (currentDebt > 0) {
        console.log('here');
        const amountToCoverDebt = Math.min(grossAmount, currentDebt * 10); // debt_cents -> cents
        const newDebt = currentDebt - amountToCoverDebt / 10;
        const { error: updateError } = await supabase.from('companies').update({
          debt_cents: newDebt
        }).eq('id', companyId);
        if (updateError) {
          console.error('❌ Failed to update debt:', updateError);
          return new Response('Failed to update debt', {
            status: 500
          });
        } else {
          console.log(`✅ Debt updated: ${currentDebt} → ${newDebt}`);
        }
      } else {
        try {
          const transfer = await stripe.transfers.create({
            amount: netToBusiness,
            currency: 'eur',
            destination: company.stripe_account_id,
            description: `Top-up balance for company ${companyId}`
          });
          console.log(`✅ Transferred ${netToBusiness} cents to business. ID: ${transfer.id}`);
        } catch (err) {
          console.error('❌ Failed to transfer to business:', err.message);
          // Handle insufficient funds error gracefully in test environment
          if (err.message.includes('insufficient available funds') || err.message.includes('Invalid source_type')) {
            console.warn('⚠️ Transfer limitation in test environment. In production, platform fees would fund this.');
            console.log(`ℹ️ Would transfer ${netToBusiness} cents to business in production`);
          } else {
            // For other errors, return failure
            return new Response('Failed to transfer to business', {
              status: 500
            });
          }
        }
      }
      const { error: insertWalletError } = await supabase.from('client_wallet').insert({
        phone_number: phoneHash,
        business_id: companyId,
        credit_balance: grossAmount
      });
      if (insertWalletError) {
        console.error('❌ Failed to insert client_wallet:', insertWalletError);
        return new Response('Failed to create wallet', {
          status: 500
        });
      }
      console.log(`✅ Created new client wallet: ${phoneHash} → ${grossAmount} credits`);
      const { error: insertError } = await supabase.from('webhook_events').insert({
        event_id: `stripe:${session.id}`,
        source: `stripe_${session.id}`,
        payload_snippet: JSON.stringify({
          type: event.type,
          amount: grossAmount,
          company_id: companyId,
          fee: platformFeeCents,
          net: netToBusiness,
          debt_before: currentDebt
        }),
        processed_at: new Date().toISOString(),
        signature_verified: false
      });
      if (insertError) {
        console.error('❌ Failed to insert webhook event:', insertError);
        return new Response('Failed to record event', {
          status: 500
        });
      }
      return new Response(JSON.stringify({
        received: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      received: true
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
