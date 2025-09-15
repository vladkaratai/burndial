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
    // Find existing user by email (iterate pages until found, cap pages for safety)
    let targetUserId = null;
    let page = 1;
    const perPage = 1000;
    while(page <= 5 && !targetUserId){
      const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({
        page,
        perPage
      });
      if (listErr) throw new Error(listErr.message);
      const found = usersPage.users.find((u)=>(u.email ?? '').toLowerCase() === body.email.toLowerCase());
      if (found) targetUserId = found.id;
      if (usersPage.users.length < perPage) break; // no more pages
      page++;
    }
    if (!targetUserId) {
      return new Response(JSON.stringify({
        error: 'User not found for given email'
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    // Upsert role (avoid duplicates)
    const { error: roleInsertErr } = await admin.from('user_roles').upsert({
      user_id: targetUserId,
      role: body.role
    }, {
      onConflict: 'user_id,role'
    });
    if (roleInsertErr) throw new Error(roleInsertErr.message);
    // If assigning business_owner with company, set as owner
    if (body.role === 'business_owner' && body.company_id) {
      const { error: updateCompanyErr } = await admin.from('companies').update({
        owner_id: targetUserId
      }).eq('id', body.company_id);
      if (updateCompanyErr) throw new Error(updateCompanyErr.message);
    }
    return new Response(JSON.stringify({
      ok: true,
      user_id: targetUserId
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (e) {
    console.error('assign-user-access error', e?.message ?? e);
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
