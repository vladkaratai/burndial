/**
 * Supabase Edge Function: provision-number
 *
 * Purpose:
 * - Buy Twilio numbers and auto-assign routing for dedicated numbers
 *   - dedicated (one number per astrologist, direct forward)
 * - Wire Twilio VoiceUrl to your n8n endpoint (so your n8n "understands" calls)
 * - Wire Twilio StatusCallback to our existing webhook-status-update function
 * - Persist service_numbers rows accordingly
 *
 * Auth:
 * - JWT required (verify_jwt = true by default). Call from your authenticated UI.
 *
 * Required secrets (set in Supabase Edge Function secrets):
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - Optional: N8N_BASE_URL (can be overridden per request)
 *
 * Inputs (POST JSON):
 * {
 *   company_id: string,
 *   country_code: string,           // e.g., "US", "GB"
 *   strategy: "dedicated",
 *   readers?: Array<{
 *     creator_id?: string,          // preferred if known
 *     forward_phone: string,        // E.164 for forwarding
 *     display_name?: string,        // optional metadata
 *   }>,
 *   n8n_webhook_url?: string,       // overrides N8N_BASE_URL if provided
 *   search_options?: {              // optional for Twilio number search
 *     areaCode?: string,
 *     contains?: string
 *   }
 * }
 *
 * Response:
 * { success: boolean, numbers: Array<{ id: string, phone_number: string, sid: string }>, error?: string }
 */ import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
function twilioAuthHeader() {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN secrets");
  }
  const basic = btoa(`${sid}:${token}`);
  return `Basic ${basic}`;
}
async function twilioSearchLocalNumber(country, query) {
  const params = new URLSearchParams({
    VoiceEnabled: "true"
  });
  if (query?.areaCode) params.append("AreaCode", query.areaCode);
  if (query?.contains) params.append("Contains", query.contains);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${Deno.env.get("TWILIO_ACCOUNT_SID")}/AvailablePhoneNumbers/${country}/Local.json?${params.toString()}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: twilioAuthHeader()
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio search failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return data?.available_phone_numbers?.[0] ?? null;
}
async function twilioBuyNumber(phoneNumber, voiceUrl, statusCallback) {
  const form = new URLSearchParams();
  form.append("PhoneNumber", phoneNumber);
  form.append("VoiceUrl", voiceUrl);
  form.append("VoiceMethod", "POST");
  form.append("StatusCallback", statusCallback);
  form.append("StatusCallbackMethod", "POST");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${Deno.env.get("TWILIO_ACCOUNT_SID")}/IncomingPhoneNumbers.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio purchase failed: ${resp.status} ${text}`);
  }
  return await resp.json();
}
async function twilioUpdateNumber(sid, voiceUrl, statusCallback) {
  const form = new URLSearchParams();
  form.append("VoiceUrl", voiceUrl);
  form.append("VoiceMethod", "POST");
  form.append("StatusCallback", statusCallback);
  form.append("StatusCallbackMethod", "POST");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${Deno.env.get("TWILIO_ACCOUNT_SID")}/IncomingPhoneNumbers/${sid}.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio update failed: ${resp.status} ${text}`);
  }
  return await resp.json();
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Method not allowed"
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const body = await req.json();
    const { company_id, country_code, strategy } = body;
    if (!company_id || !country_code || !strategy) {
      return new Response(JSON.stringify({
        error: "company_id, country_code and strategy are required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const n8nBase = body.n8n_webhook_url || Deno.env.get("N8N_BASE_URL") || "";
    if (!n8nBase) {
      console.warn("[provision-number] N8N_BASE_URL is not configured; VoiceUrl will be a no-op placeholder");
    }
    const statusCallback = `https://tntnnecgtiuqecctuxky.functions.supabase.co/webhook-status-update`;
    const out = [];
    if (strategy === "dedicated") {
      if (!body.readers || body.readers.length === 0) {
        return new Response(JSON.stringify({
          error: "readers array required for dedicated strategy"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      // One number per astrologist
      for (const reader of body.readers){
        const candidate = await twilioSearchLocalNumber(country_code, body.search_options);
        if (!candidate?.phone_number) {
          throw new Error(`No available Twilio numbers found for ${country_code}`);
        }
        // Temporarily purchase with a placeholder VoiceUrl; we'll update after we create our row and get the id
        const placeholderVoiceUrl = n8nBase || "https://example.com/voice";
        const purchase = await twilioBuyNumber(candidate.phone_number, placeholderVoiceUrl, statusCallback);
        // Insert service_numbers row
        const insertPayload = {
          phone_number: purchase.phone_number,
          service_type: "astrologer",
          routing_type: "human_forward",
          company_id,
          assigned_user_id: null,
          assigned_creator_id: reader.creator_id || null,
          trial_minutes: 0,
          requires_credits: true,
          billing_step_seconds: 60,
          forward_phone: reader.forward_phone,
          ai_persona: null,
          ai_voice: "default",
          is_active: true,
          twilio_number_sid: purchase.sid,
          country_code
        };
        const { data: created, error: insertErr } = await supabase.from("service_numbers").insert([
          insertPayload
        ]).select("id, phone_number, twilio_number_sid").maybeSingle();
        if (insertErr || !created) {
          throw new Error(`Failed to insert service number: ${insertErr?.message || "unknown"}`);
        }
        // Update Twilio VoiceUrl to include our internal service_number_id (so n8n can identify)
        if (n8nBase) {
          const voiceUrl = `${n8nBase}?service_number_id=${encodeURIComponent(created.id)}`;
          await twilioUpdateNumber(purchase.sid, voiceUrl, statusCallback);
        }
        out.push({
          id: created.id,
          phone_number: created.phone_number,
          sid: purchase.sid
        });
      }
    } else {
      return new Response(JSON.stringify({
        error: "Only dedicated strategy is supported"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      numbers: out
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error("[provision-number] error", e);
    return new Response(JSON.stringify({
      success: false,
      error: e?.message || "Unknown error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
