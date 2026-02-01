// config.js
// ВАЖНО: anon key можно держать на фронте при RLS "INSERT only".
// Заполни значения из Supabase Project Settings → API.
window.APP_CONFIG = {
  SUPABASE_URL: "https://nbdhypvqoeytigopqkwr.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_YYEE9vUf479k1dXGaIfKvg_sM8kvtc5",
  TABLE_NAME: "responses",
  // optional: lock to expected questionnaire_id
  EXPECTED_QUESTIONNAIRE_ID: "patient_form"
};
