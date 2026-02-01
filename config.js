// config.js
// ВАЖНО: anon key можно держать на фронте при RLS "INSERT only".
// Заполни значения из Supabase Project Settings → API.
window.APP_CONFIG = {
  SUPABASE_URL: "https://nbdhypvqoeytigopqkwr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iZGh5cHZxb2V5dGlnb3Bxa3dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzU1NTgsImV4cCI6MjA4NTUxMTU1OH0.FieVAdJfaw5OSd-9Ym0Bky2xx2M6fienNUyS4JvKcLg",
  TABLE_NAME: "responses",
  // optional: lock to expected questionnaire_id
  EXPECTED_QUESTIONNAIRE_ID: "patient_form"
};



