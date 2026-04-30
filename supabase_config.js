// ==================== SUPABASE CONFIG ====================
// File: supabase_config.js

// ⚠️ GANTI DENGAN CREDENTIALS PROJECT SUPABASE KAMU
// Dashboard → Settings → API
const SUPABASE_CONFIG = {
  URL: "https://ptbomzwrpuossablhjbh.supabase.co",
  ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0Ym9tendycHVvc3NhYmxoamJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODUyNjQsImV4cCI6MjA5MTM2MTI2NH0.O20zTM6sXGRYiaYOAdsF1u7sM-dFYu_JvMRMeT4eRhA",
};

// Inisialisasi client Supabase (pastikan CDN sudah load)
const supabaseClient = window.supabase.createClient(
  SUPABASE_CONFIG.URL,
  SUPABASE_CONFIG.ANON_KEY,
);

// Helper: Format error Supabase dengan user-friendly message
const handleSupabaseError = (error, context = "") => {
  console.error(`[SUPABASE] Error [${context}]:`, error);

  // Mapping error codes ke pesan yang mudah dimengerti
  const errorMessages = {
    PGRST116: "Data tidak ditemukan",
    23505: "Data sudah ada (duplicate)",
    "42P01": "Tabel tidak ditemukan - cek migration database",
    "permission denied": "Akses ditolak - cek RLS policies",
  };

  const friendlyMsg =
    errorMessages[error.code] ||
    error.message ||
    "Terjadi kesalahan koneksi database";

  // Tampilkan alert hanya untuk error kritis (bisa dimatikan untuk production)
  if (error.code && !error.code.startsWith("PGRST")) {
    // alert(`⚠️ ${context}: ${friendlyMsg}`);
  }

  return { success: false, error: friendlyMsg, code: error.code };
};

// Helper: Transform data dari Supabase ke format aplikasi
const transformSiteFromDB = (dbData) => {
  return new RefugeeSite(
    dbData.site_id,
    dbData.site_name,
    parseFloat(dbData.latitude),
    parseFloat(dbData.longitude),
    dbData.capacity || 0,
  );
};

const transformEdgeFromDB = (dbData) => {
  return new RoadEdge(
    dbData.source_node,
    dbData.target_node,
    parseFloat(dbData.distance_km),
    parseFloat(dbData.risk_factor) || 1.0,
  );
};

const transformInventoryFromDB = (dbData) => {
  return new Inventory(
    dbData.item_id,
    dbData.item_name,
    parseInt(dbData.current_stock) || 0,
    dbData.unit || "unit",
  );
};

const transformDamageFromDB = (dbData) => {
  return new DamagePoint(
    dbData.id,
    dbData.street_name,
    parseFloat(dbData.latitude),
    parseFloat(dbData.longitude),
  );
};

// Export untuk digunakan di file lain
window.SupabaseConfig = {
  client: supabaseClient,
  handleError: handleSupabaseError,
  transform: {
    site: transformSiteFromDB,
    edge: transformEdgeFromDB,
    inventory: transformInventoryFromDB,
    damage: transformDamageFromDB,
  },
};

console.log("[SUPABASE] Config loaded");
