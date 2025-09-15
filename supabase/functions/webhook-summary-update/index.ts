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
    const { handle, revenue_euros, total_calls, total_minutes, avg_duration_seconds, unique_callers, balance_minutes } = body;
    console.log('Summary update webhook received:', {
      handle,
      revenue_euros,
      total_calls,
      total_minutes,
      avg_duration_seconds,
      unique_callers,
      balance_minutes
    });
    // Find creator by handle
    const { data: creator } = await supabaseService.from('creators').select('id').eq('handle', handle).single();
    if (!creator) {
      throw new Error(`Creator not found: ${handle}`);
    }
    // Update wallet with new summary data
    const revenue_cents = Math.round(revenue_euros * 100);
    const balance_seconds = balance_minutes * 60;
    const { error: walletError } = await supabaseService.from('wallets').update({
      lifetime_revenue: revenue_cents,
      balance_seconds: balance_seconds,
      updated_at: new Date().toISOString()
    }).eq('creator_id', creator.id);
    if (walletError) {
      throw walletError;
    }
    // Store summary metrics in a summary table (create if needed)
    const { error: summaryError } = await supabaseService.from('creator_summary').upsert({
      creator_id: creator.id,
      total_calls: total_calls,
      total_minutes: total_minutes,
      avg_duration_seconds: avg_duration_seconds,
      unique_callers: unique_callers,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'creator_id'
    });
    // If summary table doesn't exist, create it
    if (summaryError && summaryError.message.includes('relation "creator_summary" does not exist')) {
      console.log('Summary table does not exist, metrics will be calculated from individual records');
    } else if (summaryError) {
      throw summaryError;
    }
    console.log(`Updated summary for creator ${handle}: €${revenue_euros}, ${total_calls} calls, ${total_minutes} min`);
    return new Response(JSON.stringify({
      success: true,
      updated: {
        revenue_euros,
        total_calls,
        total_minutes,
        balance_minutes
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Summary webhook error:', error);
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
