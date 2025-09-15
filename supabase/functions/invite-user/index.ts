import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const { data: userData, error: getUserError } = await admin.auth.getUser(authHeader);
    if (getUserError || !userData.user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    // Verify requester is god_admin
    const { data: roleRow, error: roleCheckError } = await admin.from('user_roles').select('id').eq('user_id', userData.user.id).eq('role', 'god_admin').maybeSingle();
    if (roleCheckError || !roleRow) {
      return new Response(JSON.stringify({
        error: 'Forbidden'
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const body = await req.json();
    if (!body?.email || !body?.role) {
      return new Response(JSON.stringify({
        error: 'Missing email or role'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    if (![
      'god_admin',
      'business_owner'
    ].includes(body.role)) {
      return new Response(JSON.stringify({
        error: 'Invalid role'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const origin = req.headers.get('origin') ?? undefined;
    const redirectTo = origin ? `${origin}/` : undefined;
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(body.email, {
      redirectTo
    });
    if (inviteError || !inviteData?.user) {
      throw new Error(inviteError?.message ?? 'Failed to send invite');
    }
    const invitedUserId = inviteData.user.id;
    // Assign role
    const { error: roleError } = await admin.from('user_roles').insert({
      user_id: invitedUserId,
      role: body.role
    });
    if (roleError) throw new Error(roleError.message);
    // If business_owner and company provided, set as owner
    if (body.role === 'business_owner' && body.company_id) {
      const { error: updateError } = await admin.from('companies').update({
        owner_id: invitedUserId
      }).eq('id', body.company_id);
      if (updateError) throw new Error(updateError.message);
    }
    return new Response(JSON.stringify({
      ok: true,
      user_id: invitedUserId
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (e) {
    console.error('invite-user error', e?.message ?? e);
    return new Response(JSON.stringify({
      error: e?.message ?? 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
});
