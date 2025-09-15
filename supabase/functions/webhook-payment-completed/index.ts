import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseService = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        persistSession: false
      }
    });
    const body = await req.json();
    const { handle, minutes, amount_cents, stripe_session_id, phone_hash } = body;
    console.log('Payment webhook received:', {
      handle,
      minutes,
      amount_cents,
      stripe_session_id
    });
    // Find creator by handle
    const { data: creator } = await supabaseService.from('creators').select('id').eq('handle', handle).single();
    if (!creator) {
      throw new Error(`Creator not found: ${handle}`);
    }
    const seconds = minutes * 60;
    // Add transaction record
    const { error: transactionError } = await supabaseService.from('transactions').insert({
      creator_id: creator.id,
      amount: amount_cents,
      type: 'purchase',
      phone_hash: phone_hash,
      stripe_session_id: stripe_session_id,
      status: 'completed'
    });
    if (transactionError) {
      throw transactionError;
    }
    // Update wallet balance
    const { error: walletError } = await supabaseService.from('wallets').update({
      balance_seconds: supabaseService.raw(`balance_seconds + ${seconds}`),
      lifetime_revenue: supabaseService.raw(`lifetime_revenue + ${amount_cents}`)
    }).eq('creator_id', creator.id);
    if (walletError) {
      throw walletError;
    }
    console.log(`Added ${seconds} seconds to wallet for creator ${handle}`);
    return new Response(JSON.stringify({
      success: true,
      seconds_added: seconds
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Webhook error:', error);
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
