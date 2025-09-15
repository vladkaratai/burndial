import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import Stripe from "npm:stripe@^14.0.0";
const stripe = new Stripe(Deno.env.get('STRIPE_TEST_SECRET_KEY'), {
  apiVersion: '2024-06-20'
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    const { company_id, phone, amount } = await req.json();
    if (!company_id || !phone || !amount) {
      return new Response(JSON.stringify({
        error: "Missing company_id, phone, or amount"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('🔍 Looking up company:', company_id);
    const { data: company, error: companyErr } = await supabase.from('companies').select('id, stripe_account_id').eq('id', company_id).single();
    if (companyErr || !company) {
      return new Response(JSON.stringify({
        error: "Company not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const phoneHash = await hashPhone(phone);
    const productName = `${amount} credits`;
    console.log('📦 Looking for product:', productName);
    const products = await stripe.products.list({
      active: true,
      limit: 100
    });
    const product = products.data.find((p)=>p.name === productName);
    if (!product) {
      return new Response(JSON.stringify({
        error: `Product not found: ${productName}`
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 1
    });
    if (prices.data.length === 0) {
      return new Response(JSON.stringify({
        error: `No active price for product: ${productName}`
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const priceId = prices.data[0].id;
    const grossAmountCents = amount * 100;
    const platformFeeCents = Math.round(grossAmountCents * 0.05);
    const netToBusinessCents = grossAmountCents - platformFeeCents;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      payment_intent_data: {
        metadata: {
          company_id: company_id,
          phone_hash: phoneHash,
          gross_amount_cents: grossAmountCents.toString(),
          platform_fee_cents: platformFeeCents.toString(),
          net_to_business_cents: netToBusinessCents.toString()
        }
      },
      success_url: 'http://localhost:3000/topup/success',
      cancel_url: 'http://localhost:3000/topup/cancel',
      metadata: {
        company_id: company_id,
        phone_hash: phoneHash
      }
    });
    return new Response(JSON.stringify({
      sessionId: session.id
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ create-checkout-session error:', error);
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
async function hashPhone(phone) {
  const encoder = new TextEncoder();
  const data = encoder.encode(phone.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b)=>b.toString(16).padStart(2, '0')).join('');
}
