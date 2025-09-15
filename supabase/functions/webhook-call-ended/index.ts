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
    const { handle, duration_seconds, revenue_cents, caller_hash, twilio_call_sid } = body;
    console.log('Call ended webhook received:', {
      handle,
      duration_seconds,
      revenue_cents,
      caller_hash
    });
    // Find creator by handle
    const { data: creator } = await supabaseService.from('creators').select('id').eq('handle', handle).single();
    if (!creator) {
      throw new Error(`Creator not found: ${handle}`);
    }
    // Record the call
    const { error: callError } = await supabaseService.from('calls').insert({
      creator_id: creator.id,
      duration_seconds: duration_seconds,
      revenue: revenue_cents,
      caller_hash: caller_hash,
      twilio_call_sid: twilio_call_sid
    });
    if (callError) {
      throw callError;
    }
    // Add debit transaction
    const { error: transactionError } = await supabaseService.from('transactions').insert({
      creator_id: creator.id,
      amount: -duration_seconds,
      type: 'call_debit',
      phone_hash: caller_hash,
      status: 'completed'
    });
    if (transactionError) {
      throw transactionError;
    }
    // Update wallet balance (debit seconds)
    const { error: walletError } = await supabaseService.from('wallets').update({
      balance_seconds: supabaseService.raw(`balance_seconds - ${duration_seconds}`)
    }).eq('creator_id', creator.id);
    if (walletError) {
      throw walletError;
    }
    console.log(`Debited ${duration_seconds} seconds from wallet for creator ${handle}`);
    return new Response(JSON.stringify({
      success: true,
      seconds_debited: duration_seconds
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
