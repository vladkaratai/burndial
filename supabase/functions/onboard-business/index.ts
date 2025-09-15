import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import Stripe from "npm:stripe@^14.0.0";
const stripe = new Stripe(Deno.env.get('STRIPE_TEST_SECRET_KEY'), {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient()
});
// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const supabaseService = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: {
      persistSession: false
    }
  });
  try {
    console.log('🔍 Raw Authorization header:', req.headers.get('Authorization'));
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.replace('Bearer ', '');
    console.log('🔐 Token length:', token.length);
    console.log('🔐 Token (first 50):', token.substring(0, 50));
    console.log('🔐 Token segments count:', token.split('.').length);
    let userId;
    try {
      const payload = token.split('.')[1];
      if (!payload) throw new Error('Invalid JWT: missing payload');
      const decoded = JSON.parse(atob(payload));
      if (!decoded.sub || typeof decoded.sub !== 'string') {
        throw new Error('Invalid JWT: missing or invalid sub');
      }
      userId = decoded.sub;
      console.log('✅ User ID from JWT:', userId);
    } catch (err) {
      console.error('❌ Failed to parse JWT:', err);
      throw new Error('Invalid or missing user');
    }
    const { data: user, error: userErr } = await supabaseService.auth.admin.getUserById(userId);
    if (userErr || !user.user) {
      console.error('❌ User not found:', userErr);
      throw new Error('Invalid or missing user');
    }
    const caller = user.user;
    console.log('✅ Caller:', caller.email);
    const { data: roleRows, error: roleErr } = await supabaseService.from('user_roles').select('role').eq('user_id', caller.id);
    if (roleErr) throw roleErr;
    const isGod = (roleRows || []).some((r)=>r.role === 'god_admin');
    if (!isGod) throw new Error('Forbidden: requires god_admin');
    const body = await req.json();
    try {
      console.log("📥 Received payload:", JSON.stringify(body, null, 2));
    } catch (parseError) {
      console.error("❌ Failed to parse JSON:", await req.text());
      throw new Error("Invalid JSON in request body");
    }
    if (!body.businessName || typeof body.businessName !== "string") {
      throw new Error("Missing or invalid businessName");
    }
    if (!body.ownerEmail || !body.ownerEmail.includes("@")) {
      throw new Error("Missing or invalid ownerEmail");
    }
    if (!Array.isArray(body.rows)) {
      throw new Error("Missing or invalid rows array");
    }
    const makeHandle = (email, display)=>{
      const base = (display?.trim() || email.split("@")[0] || "creator").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      return base || "creator";
    };
    const getOrInviteUser = async (email)=>{
      console.log(`📨 Inviting or finding user: ${email}`);
      const inviteRes = await supabaseService.auth.admin.inviteUserByEmail(email, {
        emailRedirectTo: `${req.headers.get("origin") || ""}/login`
      });
      if (inviteRes.data?.user) {
        console.log(`✅ User invited: ${email}`);
        return inviteRes.data.user;
      }
      const list = await supabaseService.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });
      const found = list.data.users.find((u)=>u.email?.toLowerCase() === email.toLowerCase());
      if (found) {
        console.log(`✅ User found: ${email}`);
        return found;
      }
      throw new Error(`Could not invite or find user: ${email}`);
    };
    const ownerUser = await getOrInviteUser(body.ownerEmail);
    console.log(`👤 Owner user: ${ownerUser.email} (id: ${ownerUser.id})`);
    await supabaseService.from("user_roles").upsert({
      user_id: ownerUser.id,
      role: "business_owner"
    }, {
      onConflict: "user_id,role"
    });
    console.log("✅ Owner assigned role: business_owner");
    console.log("🏢 Creating company:", body.businessName);
    const { data: companyRow, error: companyErr } = await supabaseService.from("companies").insert({
      name: body.businessName,
      owner_id: ownerUser.id
    }).select("id").single();
    if (companyErr) {
      console.error("❌ Company creation failed:", companyErr);
      throw companyErr;
    }
    console.log(`✅ Company created: ${companyRow.id}`);
    const stripe = new Stripe(Deno.env.get('STRIPE_TEST_SECRET_KEY'), {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient()
    });
    console.log("💳 Creating Stripe Connected Account for company...");
    const stripeAccount = await stripe.accounts.create({
      type: 'express',
      country: 'FI',
      email: body.ownerEmail,
      business_type: 'individual',
      settings: {
        payouts: {
          schedule: {
            interval: 'manual'
          }
        }
      },
      capabilities: {
        card_payments: {
          requested: true
        },
        transfers: {
          requested: true
        }
      },
      business_profile: {
        name: body.businessName,
        mcc: '7299',
        url: 'https://exampl1e.com'
      },
      company: {
        name: body.businessName,
        address: {
          line1: 'Katuosoite 1',
          city: 'Helsinki',
          postal_code: '00100',
          country: 'FI'
        }
      }
    });
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccount.id,
      type: 'account_onboarding',
      collect: 'eventually_due',
      refresh_url: `http://localhost:3000/dashboard?company_id=${companyRow.id}`,
      return_url: `http://localhost:3000/dashboard?company_id=${companyRow.id}&stripe=success`
    });
    const onboardingUrl = accountLink.url;
    console.log('Sesssion ', onboardingUrl);
    console.log(`✅ Stripe Account created: ${stripeAccount.id}`);
    const { error: updateErrr } = await supabaseService.from('companies').update({
      stripe_account_id: stripeAccount.id,
      stripe_onboarding_url: onboardingUrl,
      stripe_onboarding_status: 'pending',
      stripe_onboarding_sent_at: new Date().toISOString()
    }).eq('id', companyRow.id);
    if (updateErrr) {
      console.error("❌ Failed to update company with Stripe data:", updateErrr);
      throw updateErrr;
    }
    console.log("✅ Company updated with Stripe Account ID and onboarding link");
    const results = [];
    for (const row of body.rows){
      const email = row.email?.trim();
      const twilioNumber = row.phone_number?.trim();
      if (!email || !twilioNumber) {
        results.push({
          email,
          status: "skipped",
          reason: "missing email or phone_number"
        });
        continue;
      }
      try {
        const user = await getOrInviteUser(email);
        await supabaseService.from("user_roles").upsert({
          user_id: user.id,
          role: "fortune_teller"
        }, {
          onConflict: "user_id,role"
        });
        const handleBase = makeHandle(email, row.display_name);
        let handle = handleBase;
        for(let attempt = 0; attempt < 5; attempt++){
          const { data: existing } = await supabaseService.from("creators").select("id").eq("handle", handle).maybeSingle();
          if (!existing) break;
          handle = `${handleBase}-${Math.floor(Math.random() * 10000)}`;
        }
        const displayName = row.display_name?.trim() || email.split("@")[0];
        const creatorPhone = row.forward_phone?.trim() || twilioNumber;
        const { data: creatorRow, error: creatorErr } = await supabaseService.from("creators").insert({
          user_id: user.id,
          display_name: displayName,
          handle,
          phone: creatorPhone,
          online_status: true
        }).select("id").single();
        if (creatorErr) throw creatorErr;
        // Создание номера сервиса
        const { error: snErr } = await supabaseService.from("service_numbers").insert({
          phone_number: twilioNumber,
          company_id: companyRow.id,
          assigned_user_id: user.id,
          service_type: "astrologer",
          routing_type: row.forward_phone ? "human_forward" : "human_forward",
          forward_phone: row.forward_phone || null,
          is_active: true,
          requires_credits: true,
          trial_minutes: 0,
          billing_step_seconds: 60
        });
        if (snErr) throw snErr;
        results.push({
          email,
          phone_number: twilioNumber,
          status: "ok"
        });
      } catch (rowError) {
        console.error(`❌ Failed to process row for ${email}:`, rowError);
        results.push({
          email,
          status: "error",
          reason: rowError.message
        });
      }
    }
    console.log("✅ Onboarding completed successfully");
    return new Response(JSON.stringify({
      success: true,
      company_id: companyRow.id,
      owner_user_id: ownerUser.id,
      stripe_account_id: stripeAccount.id,
      stripe_onboarding_url: onboardingUrl,
      results
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("🚨 onboard-business error:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return new Response(JSON.stringify({
      error: error.message || "Internal server error",
      ...Deno.env.get("ENV") === "dev" && {
        stack: error.stack
      }
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
