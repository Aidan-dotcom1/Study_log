// ---------------------------------------------------------------------------
// The only file you need to edit to get the site running.
// ---------------------------------------------------------------------------
window.STUDY_LOG_CONFIG = {
  // Supabase → Project Settings → API
  supabaseUrl: "https://vplgjptdfsxtosmoefqk.supabase.co",

  // The key labelled "anon" / "public" (starts with eyJ...).
  // This one is meant to live in public page source — the row-level security
  // policies are what actually govern the data, not the key.
  // NEVER put the "service_role" key here.
  supabaseAnonKey: "PASTE_YOUR_ANON_KEY_HERE",

  // Aidan's courses. Edit freely — sessions store the subject name as text,
  // so adding or removing one here never breaks existing history.
  subjects: [
    "Economics A: Microeconomics I",
    "Political Science A",
    "Maths A",
    "Private Law",
    "IAW",
    "BA",
    "Psychology: Learning and Attention"
  ]
};
