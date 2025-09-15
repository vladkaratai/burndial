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
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    const token = authHeader.replace('Bearer ', '');
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user) {
      throw new Error('Unauthorized');
    }
    // Get creator profile
    const { data: creator } = await supabaseClient.from('creators').select(`
        *,
        wallets(*)
      `).eq('user_id', user.id).single();
    if (!creator) {
      throw new Error('Creator profile not found');
    }
    // Get recent calls (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: calls } = await supabaseClient.from('calls').select('*').eq('creator_id', creator.id).gte('created_at', thirtyDaysAgo.toISOString()).order('created_at', {
      ascending: false
    });
    // Get recent transactions (purchases only, last 30)
    const { data: transactions } = await supabaseClient.from('transactions').select('*').eq('creator_id', creator.id).eq('type', 'purchase').order('created_at', {
      ascending: false
    }).limit(30);
    // Calculate KPIs
    const totalRevenue = creator.wallets?.[0]?.lifetime_revenue || 0;
    const totalCalls = calls?.length || 0;
    const totalMinutes = Math.round((calls?.reduce((sum, call)=>sum + call.duration_seconds, 0) || 0) / 60);
    const avgDuration = totalCalls > 0 ? Math.round((calls?.reduce((sum, call)=>sum + call.duration_seconds, 0) || 0) / totalCalls) : 0;
    const uniqueCallers = new Set(calls?.map((call)=>call.caller_hash) || []).size;
    // Format data for frontend
    const recentCalls = calls?.slice(0, 5).map((call)=>({
        time: new Date(call.created_at).toLocaleString('fi-FI'),
        duration: `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}`,
        earned: `€${(call.revenue / 100).toFixed(2)}`,
        flag: '🇫🇮',
        number: call.caller_hash.substring(0, 8) + '...',
        fullNumber: call.caller_hash
      })) || [];
    const recentPayments = transactions?.slice(0, 5).map((transaction)=>({
        time: new Date(transaction.created_at).toLocaleString('fi-FI'),
        pkg: `${Math.round(transaction.amount / 100 / 0.83)} min`,
        amount: `€${(transaction.amount / 100).toFixed(2)}`
      })) || [];
    return new Response(JSON.stringify({
      creator: {
        handle: creator.handle,
        displayName: creator.display_name,
        phone: creator.phone,
        online: creator.online_status
      },
      wallet: {
        balanceSeconds: creator.wallets?.[0]?.balance_seconds || 0,
        lifetimeRevenue: totalRevenue
      },
      kpis: {
        totalRevenue,
        totalCalls,
        totalMinutes,
        avgDuration,
        uniqueCallers
      },
      recentCalls,
      recentPayments
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Get creator data error:', error);
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
