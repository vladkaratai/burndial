import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // === 1. Проверка: Authorization header ===
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }
    const token = authHeader.replace("Bearer ", "");
    // === 2. Создаём клиенты ===
    const supabaseAnon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      auth: {
        persistSession: false
      }
    });
    const supabaseService = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: {
        persistSession: false
      }
    });
    // === 3. Аутентификация вызывающего пользователя ===
    console.log("🔍 Validating user token...");
    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr) {
      console.error("❌ Auth error:", userErr);
      throw new Error(`Auth failed: ${userErr.message}`);
    }
    if (!userData?.user) {
      throw new Error("No user found in token");
    }
    const caller = userData.user;
    console.log("✅ Caller authenticated:", caller.email);
    // === 4. Проверка роли: god_admin ===
    console.log("🔍 Checking god_admin role...");
    const { data: roleRows, error: roleErr } = await supabaseService.from("user_roles").select("role").eq("user_id", caller.id);
    if (roleErr) {
      console.error("❌ Role check failed:", roleErr);
      throw new Error(`DB error checking role: ${roleErr.message}`);
    }
    const isGod = Array.isArray(roleRows) && roleRows.some((r)=>r.role === "god_admin");
    if (!isGod) {
      throw new Error("Forbidden: requires god_admin");
    }
    console.log("✅ User has god_admin role");
    // === 5. Парсим тело запроса ===
    let body;
    try {
      body = await req.json();
      console.log("📥 Received payload:", JSON.stringify(body, null, 2));
    } catch (parseError) {
      console.error("❌ Failed to parse JSON:", await req.text());
      throw new Error("Invalid JSON in request body");
    }
    // === 6. Валидация payload ===
    if (!body.businessName || typeof body.businessName !== "string") {
      throw new Error("Missing or invalid businessName");
    }
    if (!body.ownerEmail || !body.ownerEmail.includes("@")) {
      throw new Error("Missing or invalid ownerEmail");
    }
    if (!Array.isArray(body.rows)) {
      throw new Error("Missing or invalid rows array");
    }
    // === 7. Вспомогательные функции ===
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
      // Если приглашение не сработало — ищем в списке
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
    // === 8. Создание владельца бизнеса ===
    const ownerUser = await getOrInviteUser(body.ownerEmail);
    console.log(`👤 Owner user: ${ownerUser.email} (id: ${ownerUser.id})`);
    await supabaseService.from("user_roles").upsert({
      user_id: ownerUser.id,
      role: "business_owner"
    }, {
      onConflict: "user_id,role"
    });
    console.log("✅ Owner assigned role: business_owner");
    // === 9. Создание компании ===
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
    const results = [];
    // === 10. Обработка астрологов ===
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
        // Генерация уникального handle
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
    // === 11. Успешный ответ ===
    console.log("✅ Onboarding completed successfully");
    return new Response(JSON.stringify({
      success: true,
      company_id: companyRow.id,
      owner_user_id: ownerUser.id,
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
