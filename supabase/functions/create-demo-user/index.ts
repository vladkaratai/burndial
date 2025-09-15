import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { email, password } = await req.json();
    if (!email || !password) {
      return new Response(JSON.stringify({
        error: 'Missing email or password'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false
      }
    });
    // 1) Create or fetch user
    const { data: existingUser } = await supabase.from('user_roles').select('user_id').limit(1);
    // Try to find by email via Admin API
    const { data: listUsers } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200
    });
    let user = listUsers?.users?.find((u)=>u.email === email) || null;
    if (!user) {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });
      if (createErr || !created.user) {
        console.error('createUser error', createErr);
        return new Response(JSON.stringify({
          error: createErr?.message || 'Failed to create user'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      user = created.user;
    }
    const userId = user.id;
    // 2) Ensure role 'business_owner'
    const { data: roleRow } = await supabase.from('user_roles').select('id').eq('user_id', userId).eq('role', 'business_owner').maybeSingle();
    if (!roleRow) {
      const { error: insertRoleErr } = await supabase.from('user_roles').insert({
        user_id: userId,
        role: 'business_owner'
      });
      if (insertRoleErr) {
        console.error('insert role error', insertRoleErr);
        return new Response(JSON.stringify({
          error: insertRoleErr.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // 3) Ensure a company assigned to this owner
    const { data: existingCompany } = await supabase.from('companies').select('id').eq('owner_id', userId).maybeSingle();
    let companyId = existingCompany?.id || null;
    if (!companyId) {
      const { data: company, error: companyErr } = await supabase.from('companies').insert({
        name: 'Demo Company',
        owner_id: userId
      }).select('id').single();
      if (companyErr) {
        console.error('insert company error', companyErr);
        return new Response(JSON.stringify({
          error: companyErr.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      companyId = company.id;
    }
    return new Response(JSON.stringify({
      success: true,
      userId,
      companyId
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    console.error('Unexpected error', e);
    return new Response(JSON.stringify({
      error: 'Unexpected error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
