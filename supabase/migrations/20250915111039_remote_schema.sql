

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_role" AS ENUM (
    'god_admin',
    'business_owner',
    'fortune_teller'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."routing_type" AS ENUM (
    'human_forward',
    'ai_answers'
);


ALTER TYPE "public"."routing_type" OWNER TO "postgres";


CREATE TYPE "public"."service_type" AS ENUM (
    'astrologer',
    'ai_model',
    'premium_rate'
);


ALTER TYPE "public"."service_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_url_slug"("input_text" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  -- Convert to lowercase, replace spaces and special chars with hyphens
  RETURN regexp_replace(
    regexp_replace(
      lower(trim(input_text)), 
      '[^a-z0-9]+', '-', 'g'
    ), 
    '^-+|-+$', '', 'g'
  );
END;
$_$;


ALTER FUNCTION "public"."generate_url_slug"("input_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_creator"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  INSERT INTO public.wallets (creator_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_creator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."business_countries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "country_code" "text" NOT NULL,
    "price_per_minute" integer NOT NULL,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "local_address" "text",
    "compliance_docs" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."business_countries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."call_summaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "call_id" "uuid" NOT NULL,
    "service_number_id" "uuid" NOT NULL,
    "caller_phone_hash" "text" NOT NULL,
    "summary" "text",
    "tone_score" integer,
    "transcript_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."call_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."caller_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_number_id" "uuid" NOT NULL,
    "caller_phone_hash" "text" NOT NULL,
    "credits_seconds" integer DEFAULT 0 NOT NULL,
    "trial_used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."caller_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "creator_id" "uuid",
    "duration_seconds" integer NOT NULL,
    "revenue" integer NOT NULL,
    "caller_hash" "text" NOT NULL,
    "twilio_call_sid" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "service_number_id" "uuid",
    "caller_phone_hash" "text",
    "is_trial_call" boolean DEFAULT false,
    "call_status" "text" DEFAULT 'completed'::"text"
);


ALTER TABLE "public"."calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_wallet" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatete_at" timestamp with time zone DEFAULT "now"(),
    "credit_balance" numeric DEFAULT '0'::numeric,
    "business_id" "uuid",
    "phone_number" "text" NOT NULL
);


ALTER TABLE "public"."client_wallet" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "url_slug" "text",
    "country_services" "text"[],
    "vertical" "text",
    "price_per_minute" "jsonb",
    "default_language" "text" DEFAULT 'en'::"text",
    "billing_model" "text" DEFAULT 'prepaid'::"text",
    "registered_business_details" "jsonb",
    "rep_contact" "jsonb",
    "payout_iban" "text",
    "compliance_documents" "jsonb",
    "terms_accepted_at" timestamp with time zone,
    "subscription_plan" "text" DEFAULT 'core'::"text",
    "custom_pricing" "jsonb",
    "platform_fee_percentage" numeric(4,2) DEFAULT 7.99,
    "stripe_account_id" "text",
    "stripe_onboarding_url" "text",
    "stripe_onboarding_sent_at" "date",
    "stripe_onboarding_status" "text",
    "debt_cents" double precision DEFAULT '0'::double precision NOT NULL,
    CONSTRAINT "companies_subscription_plan_check" CHECK (("subscription_plan" = ANY (ARRAY['core'::"text", 'growth'::"text", 'scale'::"text"])))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."creators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "handle" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "online_status" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    "url_slug" "text"
);


ALTER TABLE "public"."creators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "requested_amount" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "processed_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payout_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."payout_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_numbers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_number" "text" NOT NULL,
    "service_type" "public"."service_type" NOT NULL,
    "routing_type" "public"."routing_type" NOT NULL,
    "company_id" "uuid",
    "assigned_user_id" "uuid",
    "trial_minutes" integer DEFAULT 0 NOT NULL,
    "requires_credits" boolean DEFAULT true NOT NULL,
    "payout_rate_cents" integer,
    "billing_step_seconds" integer DEFAULT 60,
    "forward_phone" "text",
    "ai_persona" "text",
    "ai_voice" "text" DEFAULT 'alloy'::"text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "schedule" "jsonb",
    "queue_settings" "jsonb",
    "time_limits" "jsonb",
    "spend_caps" "jsonb",
    "recording_enabled" boolean DEFAULT false,
    "twilio_number_sid" "text",
    "country_code" "text",
    "assigned_creator_id" "uuid",
    "price_per_minute_cents" numeric DEFAULT '300'::numeric NOT NULL
);


ALTER TABLE "public"."service_numbers" OWNER TO "postgres";


COMMENT ON TABLE "public"."service_numbers" IS 'Each service number is dedicated to one astrologist - no more IVR menus';



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "creator_id" "uuid",
    "amount" integer NOT NULL,
    "type" "text" NOT NULL,
    "phone_hash" "text",
    "stripe_session_id" "text",
    "status" "text" DEFAULT 'completed'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "service_number_id" "uuid",
    CONSTRAINT "transactions_type_check" CHECK (("type" = ANY (ARRAY['purchase'::"text", 'call_debit'::"text", 'withdrawal'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "creator_id" "uuid",
    "balance" double precision DEFAULT 0 NOT NULL,
    "pending_amount" integer DEFAULT 0,
    "lifetime_revenue" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT ''::"text" NOT NULL,
    "event_id" "text" NOT NULL,
    "payload_snippet" "jsonb",
    "signature_verified" boolean,
    "processed" boolean DEFAULT false,
    "error" "text",
    "processed_at" timestamp with time zone
);


ALTER TABLE "public"."webhook_events" OWNER TO "postgres";


ALTER TABLE ONLY "public"."business_countries"
    ADD CONSTRAINT "business_countries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_summaries"
    ADD CONSTRAINT "call_summaries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caller_credits"
    ADD CONSTRAINT "caller_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caller_credits"
    ADD CONSTRAINT "caller_credits_service_number_id_caller_phone_hash_key" UNIQUE ("service_number_id", "caller_phone_hash");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_twilio_call_sid_key" UNIQUE ("twilio_call_sid");



ALTER TABLE ONLY "public"."client_wallet"
    ADD CONSTRAINT "client_wallet_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."client_wallet"
    ADD CONSTRAINT "client_wallet_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_url_slug_unique" UNIQUE ("url_slug");



ALTER TABLE ONLY "public"."creators"
    ADD CONSTRAINT "creators_company_creator_slug_unique" UNIQUE ("company_id", "url_slug");



ALTER TABLE ONLY "public"."creators"
    ADD CONSTRAINT "creators_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."creators"
    ADD CONSTRAINT "creators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."creators"
    ADD CONSTRAINT "creators_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_numbers"
    ADD CONSTRAINT "service_numbers_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."service_numbers"
    ADD CONSTRAINT "service_numbers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_creator_id_key" UNIQUE ("creator_id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_event_id_key" UNIQUE ("event_id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_source_key" UNIQUE ("source");



CREATE INDEX "caller_credits_hash_idx" ON "public"."caller_credits" USING "btree" ("caller_phone_hash", "service_number_id");



CREATE INDEX "calls_hash_idx" ON "public"."calls" USING "btree" ("caller_phone_hash", "service_number_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "on_creator_created" AFTER INSERT ON "public"."creators" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_creator"();



CREATE OR REPLACE TRIGGER "update_business_countries_updated_at" BEFORE UPDATE ON "public"."business_countries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_caller_credits_updated_at" BEFORE UPDATE ON "public"."caller_credits" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_companies_updated_at" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_creators_updated_at" BEFORE UPDATE ON "public"."creators" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_payout_requests_updated_at" BEFORE UPDATE ON "public"."payout_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_service_numbers_updated_at" BEFORE UPDATE ON "public"."service_numbers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_wallets_updated_at" BEFORE UPDATE ON "public"."wallets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."business_countries"
    ADD CONSTRAINT "business_countries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_summaries"
    ADD CONSTRAINT "call_summaries_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_summaries"
    ADD CONSTRAINT "call_summaries_service_number_id_fkey" FOREIGN KEY ("service_number_id") REFERENCES "public"."service_numbers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caller_credits"
    ADD CONSTRAINT "caller_credits_service_number_id_fkey" FOREIGN KEY ("service_number_id") REFERENCES "public"."service_numbers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calls"
    ADD CONSTRAINT "calls_service_number_id_fkey" FOREIGN KEY ("service_number_id") REFERENCES "public"."service_numbers"("id");



ALTER TABLE ONLY "public"."client_wallet"
    ADD CONSTRAINT "client_wallet_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."creators"
    ADD CONSTRAINT "creators_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."creators"
    ADD CONSTRAINT "creators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_numbers"
    ADD CONSTRAINT "service_numbers_assigned_creator_id_fkey" FOREIGN KEY ("assigned_creator_id") REFERENCES "public"."creators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_numbers"
    ADD CONSTRAINT "service_numbers_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_numbers"
    ADD CONSTRAINT "service_numbers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_service_number_id_fkey" FOREIGN KEY ("service_number_id") REFERENCES "public"."service_numbers"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE CASCADE;



CREATE POLICY "Business owners can manage their companies" ON "public"."companies" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Business owners can manage their country settings" ON "public"."business_countries" USING (("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."owner_id" = "auth"."uid"()))));



CREATE POLICY "Business owners can manage their payout requests" ON "public"."payout_requests" USING (("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."owner_id" = "auth"."uid"()))));



CREATE POLICY "Business owners can manage their service numbers" ON "public"."service_numbers" USING (("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."owner_id" = "auth"."uid"()))));



CREATE POLICY "Business owners can view their numbers' summaries" ON "public"."call_summaries" FOR SELECT USING (("service_number_id" IN ( SELECT "service_numbers"."id"
   FROM "public"."service_numbers"
  WHERE ("service_numbers"."company_id" IN ( SELECT "companies"."id"
           FROM "public"."companies"
          WHERE ("companies"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "Fortune tellers can view assigned numbers" ON "public"."service_numbers" FOR SELECT USING (("auth"."uid"() = "assigned_user_id"));



CREATE POLICY "Fortune tellers can view their summaries" ON "public"."call_summaries" FOR SELECT USING (("service_number_id" IN ( SELECT "service_numbers"."id"
   FROM "public"."service_numbers"
  WHERE ("service_numbers"."assigned_user_id" = "auth"."uid"()))));



CREATE POLICY "God admins can manage all country settings" ON "public"."business_countries" USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can manage all roles" ON "public"."user_roles" USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can manage all service numbers" ON "public"."service_numbers" USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can update payout requests" ON "public"."payout_requests" FOR UPDATE USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can view all companies" ON "public"."companies" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can view all payout requests" ON "public"."payout_requests" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can view all summaries" ON "public"."call_summaries" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "God admins can view caller credits" ON "public"."caller_credits" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role"));



CREATE POLICY "Service role can insert calls" ON "public"."calls" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can insert transactions" ON "public"."transactions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can manage caller credits" ON "public"."caller_credits" USING (true);



CREATE POLICY "Service role can update creators" ON "public"."creators" FOR UPDATE USING (true);



CREATE POLICY "Service role can update wallets" ON "public"."wallets" FOR UPDATE USING (true);



CREATE POLICY "Users can insert their own creator profile" ON "public"."creators" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own creator profile" ON "public"."creators" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view calls for their service numbers" ON "public"."calls" FOR SELECT USING (("public"."has_role"("auth"."uid"(), 'god_admin'::"public"."app_role") OR ("service_number_id" IN ( SELECT "sn"."id"
   FROM ("public"."service_numbers" "sn"
     JOIN "public"."companies" "c" ON (("sn"."company_id" = "c"."id")))
  WHERE ("c"."owner_id" = "auth"."uid"()))) OR ("service_number_id" IN ( SELECT "service_numbers"."id"
   FROM "public"."service_numbers"
  WHERE ("service_numbers"."assigned_user_id" = "auth"."uid"()))) OR ("creator_id" IN ( SELECT "creators"."id"
   FROM "public"."creators"
  WHERE ("creators"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own creator profile" ON "public"."creators" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own transactions" ON "public"."transactions" FOR SELECT USING (("creator_id" IN ( SELECT "creators"."id"
   FROM "public"."creators"
  WHERE ("creators"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own wallet" ON "public"."wallets" FOR SELECT USING (("creator_id" IN ( SELECT "creators"."id"
   FROM "public"."creators"
  WHERE ("creators"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."business_countries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."call_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."caller_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_wallet" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."creators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_numbers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_events" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."creators";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."generate_url_slug"("input_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_url_slug"("input_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_url_slug"("input_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_creator"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_creator"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_creator"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."business_countries" TO "anon";
GRANT ALL ON TABLE "public"."business_countries" TO "authenticated";
GRANT ALL ON TABLE "public"."business_countries" TO "service_role";



GRANT ALL ON TABLE "public"."call_summaries" TO "anon";
GRANT ALL ON TABLE "public"."call_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."call_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."caller_credits" TO "anon";
GRANT ALL ON TABLE "public"."caller_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."caller_credits" TO "service_role";



GRANT ALL ON TABLE "public"."calls" TO "anon";
GRANT ALL ON TABLE "public"."calls" TO "authenticated";
GRANT ALL ON TABLE "public"."calls" TO "service_role";



GRANT ALL ON TABLE "public"."client_wallet" TO "anon";
GRANT ALL ON TABLE "public"."client_wallet" TO "authenticated";
GRANT ALL ON TABLE "public"."client_wallet" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."creators" TO "anon";
GRANT ALL ON TABLE "public"."creators" TO "authenticated";
GRANT ALL ON TABLE "public"."creators" TO "service_role";



GRANT ALL ON TABLE "public"."payout_requests" TO "anon";
GRANT ALL ON TABLE "public"."payout_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_requests" TO "service_role";



GRANT ALL ON TABLE "public"."service_numbers" TO "anon";
GRANT ALL ON TABLE "public"."service_numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."service_numbers" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."wallets" TO "anon";
GRANT ALL ON TABLE "public"."wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."wallets" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
