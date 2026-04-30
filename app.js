// ==================== APP CONTROLLER ====================
// File: app.js

const controller = {
  // === DATA STATE ===
  sites: {},
  edges: [],
  inventory: [],
  damagePoints: [],
  graph: null, // RoadGraph untuk Dijkstra

  // === MAP & UI STATE ===
  map: null,
  routingControl: null,
  currentRouteLayer: null,
  debugLayer: null,
  currentRouteCoords: [],
  hoverLayer: null,
  interactionLayers: [],
  subscriptions: {}, // Untuk realtime Supabase

  // === AUTH & CONFIG ===
  systemPass: localStorage.getItem("saved_pass") || "123",
  currentUser: null,
  dbConnected: false,
  ORS_TOKEN: "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImY3NjcyNGIxYjE4ODRhODA5ZDUxMmNiNzM3MDFkNjk5IiwiaCI6Im11cm11cjY0In0=",

  // === INITIALIZATION ===
  async init() {
    console.log("[INIT] Step 1: Starting...");

    // Show loading overlay
    this.showLoading("Menghubungkan ke database...");
    console.log("[INIT] Step 2: ShowLoading called");

    try {
      // Initialize default password
      if (!localStorage.getItem("saved_pass")) {
        localStorage.setItem("saved_pass", "123");
      }
      console.log("[INIT] Step 3: Password init done");

      // Initialize map
      this.initMap();
      console.log("[INIT] Step 4: Map init done");

      // Test Supabase connection
      await this.testDatabaseConnection();
      console.log("[INIT] Step 5: Database test done");

      // Load persistent data (from Supabase or localStorage fallback)
      await this.loadPersistentData();
      console.log("[INIT] Step 6: Data loaded");

      // Check for saved login session
      const savedRole = localStorage.getItem("current_role");
      if (savedRole) {
        this.applyPermissions(savedRole);
      }
      console.log("[INIT] Step 7: Permissions applied");

      // Render UI
      this.renderAll();
      console.log("[INIT] Step 8: UI rendered");

      // Setup realtime subscriptions (optional)
      this.setupRealtimeSubscriptions();
      console.log("[INIT] Step 9: Realtime setup done");

    } catch (err) {
      console.error("[INIT] Error at step:", err);
    } finally {
      // ALWAYS hide loading overlay
      this.hideLoading();
      console.log("[INIT] Step 10: hideLoading done");
    }

    console.log("[INIT] Application initialized");
  },

  initMap() {
    this.map = L.map("map").setView([3.59, 98.67], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors | SIM Logistik Sumut",
    }).addTo(this.map);
  },

  // === DATABASE CONNECTION ===
  async testDatabaseConnection() {
    try {
      // Cek apakah Supabase client tersedia
      if (!window.SupabaseConfig?.client) {
        throw new Error("Supabase client not loaded");
      }

      // Test query sederhana
      const { data, error } = await window.SupabaseConfig.client.from("refugee_sites").select("site_id").limit(1);

      if (error) throw error;

      // Update UI status
      this.dbConnected = true;
      this.updateDbStatus(true, "Connected");
      this.updateLoadingStatus("Database terhubung");

      console.log("[DB] Supabase connected");
      return true;
    } catch (err) {
      this.dbConnected = false;
      this.updateDbStatus(false, "Offline");
      this.updateLoadingStatus("Menggunakan cache lokal");

      console.warn("[DB] Connection failed, using localStorage fallback:", err);
      return false;
    }
  },

  updateDbStatus(connected, message) {
    const statusEl = document.getElementById("db-status");
    const fixedEl = document.getElementById("db-status-fixed");

    if (statusEl) {
      statusEl.className = `db-status ${connected ? "connected" : "disconnected"}`;
      statusEl.querySelector("span").textContent = message;
    }
    if (fixedEl) {
      fixedEl.className = `db-status ${connected ? "connected" : "disconnected"}`;
      fixedEl.querySelector("span").textContent = `Database: ${message}`;
    }
  },

  showLoading(message) {
    const overlay = document.getElementById("loading-overlay");
    const status = document.getElementById("loading-status");
    if (overlay) overlay.style.display = "flex";
    if (status && message) status.textContent = message;
  },

  hideLoading() {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.visibility = "hidden";
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
    }
    // Also force hide any lingering overlays
    const loadingEl = document.querySelector('.loading-overlay');
    if (loadingEl) {
      loadingEl.style.display = "none";
    }
  },

  updateLoadingStatus(message) {
    const status = document.getElementById("loading-status");
    if (status) status.textContent = message;
  },

  // === DATA LOADING & SAVING ===
  async loadPersistentData() {
    console.log("[LOAD] Memuat semua data...");

    const client = window.SupabaseConfig?.client;
    if (!client) {
      console.error("[LOAD] Supabase client tidak ditemukan, pakai localStorage");
      this.loadFromLocalStorage();
      setTimeout(() => this.renderAll(), 50);
      return;
    }

    try {
      // Fetch semua tabel secara paralel
      const [sitesRes, edgesRes, invRes, damageRes] = await Promise.all([
        client.from("refugee_sites").select("*"),
        client.from("road_edges").select("*").eq("is_active", true),
        client.from("inventory").select("*"),
        client.from("damage_points").select("*").eq("is_active", true),
      ]);

      if (sitesRes.error) throw sitesRes.error;
      if (edgesRes.error) throw edgesRes.error;
      if (invRes.error) throw invRes.error;
      if (damageRes.error) throw damageRes.error;

      // --- Proses sites ---
      this.sites = {};
      if (sitesRes.data && sitesRes.data.length > 0) {
        sitesRes.data.forEach((row) => {
          this.sites[row.site_id] = new RefugeeSite(row.site_id, row.site_name, parseFloat(row.latitude), parseFloat(row.longitude), row.capacity || 0);
        });
      }
      if (!this.sites["MDN"]) {
        this.sites["MDN"] = new RefugeeSite("MDN", "Gudang Utama Medan", 3.595, 98.672, 0);
      }

      // --- Proses edges ---
      this.edges = edgesRes.data?.map((e) => new RoadEdge(e.source_node, e.target_node, parseFloat(e.distance_km), parseFloat(e.risk_factor) || 1)) || [];
      if (this.edges.length === 0) this.edges = [new RoadEdge("MDN", "MDN", 0, 1)];

      // --- Proses inventory ---
      this.inventory = invRes.data?.map((i) => new Inventory(i.item_id, i.item_name, i.current_stock, i.unit)) || [];

      // --- Proses damage points ---
      this.damagePoints = damageRes.data?.map((d) => new DamagePoint(d.id, d.street_name, parseFloat(d.latitude), parseFloat(d.longitude))) || [];

      console.log(`[LOAD] Loaded: ${Object.keys(this.sites).length} sites, ${this.edges.length} edges, ${this.inventory.length} inventory, ${this.damagePoints.length} damage points`);

      // Simpan ke cache
      this.saveToLocalStorage();
    } catch (err) {
      console.error("[LOAD] Gagal load dari Supabase:", err);
      this.loadFromLocalStorage();
    } finally {
      setTimeout(() => this.renderAll(), 100);
    }
  },
  loadFromLocalStorage() {
    const s = JSON.parse(localStorage.getItem("final_db_sites"));
    const e = JSON.parse(localStorage.getItem("final_db_edges"));
    const i = JSON.parse(localStorage.getItem("final_db_inv"));
    const d = JSON.parse(localStorage.getItem("final_db_dmg"));

    if (s) {
      Object.keys(s).forEach((k) => {
        this.sites[k] = new RefugeeSite(s[k].siteId, s[k].siteName, s[k].latitude, s[k].longitude, s[k].capacity);
      });
    } else {
      this.sites = {
        MDN: new RefugeeSite("MDN", "Gudang Utama Medan", 3.595, 98.672, 0),
      };
    }

    this.edges = e ? e.map((re) => new RoadEdge(re.from, re.to, re.distance, re.riskFactor)) : [new RoadEdge("MDN", "MDN", 0, 1)];
    // Di bagian proses inventory:
    this.inventory =
      invRes.data?.map(
        (i) =>
          new Inventory(
            i.item_id,
            i.item_name,
            parseInt(i.current_stock) || 0,
            i.unit || "unit",
            i.site_id, // [OK] Baca site_id dari DB
          ),
      ) || [];
    this.damagePoints = d ? d.map((rd) => new DamagePoint(rd.id, rd.street, rd.latitude, rd.longitude)) : [];
  },

  async saveAndRefresh() {
    try {
      console.log("[SAVE] Saving data...");

      // Selalu simpan ke localStorage sebagai cache/backup
      this.saveToLocalStorage();

      // Jika database terhubung, sync ke Supabase
      if (this.dbConnected) {
        await this.syncToSupabase();
      }

      this.renderAll();
      console.log("[SAVE] Data saved");
    } catch (error) {
      console.error("[SAVE] Error saving data:", error);
      window.SupabaseConfig?.handleError(error, "saving data");

      // Tetap render UI meski save ke DB gagal
      this.renderAll();
    }
  },

  saveToLocalStorage() {
    localStorage.setItem("final_db_sites", JSON.stringify(this.sites));
    localStorage.setItem("final_db_edges", JSON.stringify(this.edges));
    localStorage.setItem("final_db_inv", JSON.stringify(this.inventory));
    localStorage.setItem("final_db_dmg", JSON.stringify(this.damagePoints));
  },

  async syncToSupabase() {
    const { client } = window.SupabaseConfig;

    // 1. Sync refugee_sites (UPSERT)
    const sitesPayload = Object.values(this.sites).map((s) => ({
      site_id: s.siteId,
      site_name: s.siteName,
      latitude: s.latitude,
      longitude: s.longitude,
      capacity: s.capacity,
    }));

    if (sitesPayload.length > 0) {
      const { error } = await client.from("refugee_sites").upsert(sitesPayload, {
        onConflict: "site_id",
        ignoreDuplicates: false,
      });
      if (error) throw error;
    }

    // 2. Sync road_edges
    // Hapus edges lama untuk sync yang bersih (opsional, bisa dioptimasi)
    await client.from("road_edges").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const edgesPayload = this.edges.map((e) => ({
      source_node: e.from,
      target_node: e.to,
      distance_km: e.distance,
      risk_factor: e.riskFactor,
      is_active: true,
    }));

    if (edgesPayload.length > 0) {
      const { error } = await client.from("road_edges").insert(edgesPayload);
      if (error) throw error;
    }

    // 3. Sync inventory
    await client.from("inventory").delete().neq("item_id", "00000000-0000-0000-0000-000000000000");

    // 3. SYNC INVENTORY - FIX: Jangan kirim item_id, biar DB yang generate UUID
    // Di dalam syncToSupabase(), bagian inventory:
    // 3. Sync inventory - UPSERT berdasarkan item_name + site_id
    const invPayload = this.inventory.map((i) => ({
      item_name: i.itemName,
      current_stock: parseInt(i.currentStock) || 0,
      unit: i.unit || "unit",
      site_id: i.siteId || null, // kirim site_id
      category: null,
    }));

    if (invPayload.length > 0) {
      const { error: invErr, data: upsertedData } = await client
        .from("inventory")
        .upsert(invPayload, {
          onConflict: "item_name, site_id", // unik berdasarkan nama + posko
          ignoreDuplicates: false,
        })
        .select(); // ambil data yang baru (termasuk UUID asli)

      if (invErr) {
        console.error("[SYNC] Inventory sync ERROR:", invErr);
        throw invErr;
      }

      // Update state inventory dengan data dari DB (ID asli, stok terbaru)
      if (upsertedData && upsertedData.length > 0) {
        this.inventory = upsertedData.map((dbItem) => new Inventory(dbItem.item_id, dbItem.item_name, dbItem.current_stock, dbItem.unit, dbItem.site_id));
      }
      console.log(`[SYNC] Inventory synced: ${upsertedData?.length || 0} rows`);
    }

    // 4. Sync damage_points
    await client.from("damage_points").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const dmgPayload = this.damagePoints.map((d) => ({
      id: d.id,
      street_name: d.street,
      latitude: d.latitude,
      longitude: d.longitude,
      is_active: true,
    }));

    if (dmgPayload.length > 0) {
      const { error } = await client.from("damage_points").insert(dmgPayload);
      if (error) throw error;
    }

    console.log("[SYNC] Data synced to Supabase");
  },

  // Manual sync button
  async syncData() {
    this.showLoading("Syncing data to database...");
    try {
      await this.syncToSupabase();
      alert("Data berhasil disinkronisasi ke database!");
    } catch (error) {
      alert("Sync gagal: " + (error.message || "Unknown error"));
    } finally {
      this.hideLoading();
    }
  },

  // === AUTHENTICATION ===
  handleLogin(e) {
    e.preventDefault();
    const role = document.getElementById("login-role").value;
    const pass = document.getElementById("login-pass").value;

    if (!role) {
      alert("Pilih role pengguna terlebih dahulu!");
      return;
    }

    if (pass === this.systemPass) {
      localStorage.setItem("current_role", role);
      this.currentUser = { role };
      this.applyPermissions(role);
    } else {
      alert("Password Salah!");
    }
  },

  handleChangePassword() {
    const oldP = document.getElementById("pass-old").value;
    const newP = document.getElementById("pass-new").value;

    if (oldP !== this.systemPass) {
      alert("Password lama salah!");
      return;
    }

    if (!newP || newP.length < 3) {
      alert("Password baru terlalu pendek (min. 3 karakter)!");
      return;
    }

    this.systemPass = newP;
    localStorage.setItem("saved_pass", newP);

    alert("Password berhasil diperbarui!");

    // Reset form
    document.getElementById("pass-old").value = "";
    document.getElementById("pass-new").value = "";
    document.getElementById("change-pass-section").classList.add("d-none");
  },

  applyPermissions(role) {
    // Hide login, show app
    document.getElementById("login-overlay").classList.add("d-none");
    document.getElementById("app-sidebar").classList.remove("d-none");
    document.getElementById("app-content").classList.remove("d-none");

    // Hide all menu buttons first
    const menus = ["nav-koordinator", "nav-admin", "nav-lapangan", "nav-gudang"];
    menus.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("d-none");
    });

    // Show menus based on role
    if (role === "Administrator") {
      menus.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("d-none");
      });
      this.switchTab("admin");
    } else if (role === "Koordinator") {
      document.getElementById("nav-koordinator")?.classList.remove("d-none");
      this.switchTab("koordinator");
    } else if (role === "Petugas Lapangan") {
      document.getElementById("nav-lapangan")?.classList.remove("d-none");
      this.switchTab("tab-lapangan");
    } else if (role === "Petugas Gudang") {
      document.getElementById("nav-gudang")?.classList.remove("d-none");
      this.switchTab("gudang");
    }

    // Refresh map size after tabs switch
    setTimeout(() => {
      if (this.map && document.getElementById("map")) {
        this.map.invalidateSize();
        this.map.setView([3.595, 98.672], 10);
      }
    }, 300);
  },

  // === TAB SWITCHING ===
  switchTab(tabId) {
    // Remove active class from all nav items
    document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));

    // Add active class to clicked nav
    const navMap = {
      "koordinator": "nav-koordinator",
      "admin": "nav-admin",
      "tab-lapangan": "nav-lapangan",
      "gudang": "nav-gudang"
    };
    const navEl = document.getElementById(navMap[tabId]);
    if (navEl) navEl.classList.add("active");

    // Hide all tab contents
    document.querySelectorAll(".tab-pane").forEach((el) => el.classList.remove("show", "active"));

    // Show selected tab
    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.add("show", "active");

    // Refresh map if coordinator tab
    if (tabId === "koordinator") {
      setTimeout(() => this.map?.invalidateSize(), 100);
    }
  },

  handleLogout() {
    // Unsubscribe realtime channels
    if (this.subscriptions) {
      Object.values(this.subscriptions).forEach((sub) => {
        if (sub?.unsubscribe) sub.unsubscribe();
      });
    }

    // Clear session
    localStorage.removeItem("current_role");
    this.currentUser = null;

    // Reload page
    location.reload();
  },

  // === REALTIME SUBSCRIPTIONS (Optional) ===
  setupRealtimeSubscriptions() {
    if (!this.dbConnected || !window.SupabaseConfig?.client) return;

    const { client } = window.SupabaseConfig;

    // Subscribe to damage_points changes
    this.subscriptions.damage = client
      .channel("damage-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "damage_points" }, (payload) => {
        console.log("[REALTIME] Damage point changed:", payload.eventType, payload.new);

        // Auto-recalculate risks when damage changes
        this.recalculateRisks();
        this.renderAll();

        // Show notification for new damage reports
        if (payload.eventType === "INSERT") {
          // Bisa tambahkan toast notification di sini
          console.warn("[REALTIME] Titik kerusakan baru dilaporkan!");
        }
      })
      .subscribe();

    console.log("[REALTIME] Realtime subscriptions setup");
  },

  // === GEOCODING ===
  async getCoords(address) {
    if (!address) return null;

    const query = `${address}, Sumatera Utara, Indonesia`;

    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "SIM-Logistik-Sumut-Nadya" } });

      const data = await resp.json();

      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
      return null;
    } catch (err) {
      console.error("Geocoding error:", err);
      return null;
    }
  },

  // === ADMIN: SITE MANAGEMENT ===
  async handleAddSite(e) {
    e.preventDefault();

    const name = document.getElementById("adm-name").value.trim();
    const latInput = document.getElementById("adm-lat-manual").value;
    const lngInput = document.getElementById("adm-lng-manual").value;

    if (!name || !latInput || !lngInput) {
      alert("Nama, Latitude, dan Longitude wajib diisi!");
      return;
    }

    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);

    if (isNaN(lat) || isNaN(lng)) {
      alert("Latitude dan Longitude harus berupa angka!");
      return;
    }

    // Generate unique ID
    const id = "POS_" + Date.now();

    // Create and add to state
    this.sites[id] = new RefugeeSite(id, name, lat, lng, 500);

    // Auto-connect to MDN (bisa dikembangkan untuk routing dinamis)
    this.edges.push(new RoadEdge("MDN", id, 40, 1.0));

    // Save and refresh
    await this.saveAndRefresh();

    alert(`Posko "${name}" berhasil disimpan!`);
    e.target.reset();
  },

  async deleteSite(id) {
    if (id === "MDN") {
      alert("Tidak dapat menghapus Gudang Utama (MDN)!");
      return;
    }

    if (!confirm(`Hapus posko "${this.sites[id]?.siteName}"?`)) return;

    // Delete from state
    delete this.sites[id];
    this.edges = this.edges.filter((edge) => edge.from !== id && edge.to !== id);

    // Save and refresh
    await this.saveAndRefresh();
  },

  // === ADMIN: DAMAGE MANAGEMENT ===
  async handleMarkDamage(e) {
    e.preventDefault();

    const street = document.getElementById("dmg-street").value.trim() || "Jalan Rusak";
    const latInput = document.getElementById("dmg-lat-manual").value;
    const lngInput = document.getElementById("dmg-lng-manual").value;

    if (!latInput || !lngInput) {
      alert("Latitude dan Longitude wajib diisi!");
      return;
    }

    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);

    if (isNaN(lat) || isNaN(lng)) {
      alert("Latitude dan Longitude harus berupa angka!");
      return;
    }

    // Create damage point
    const dmgId = "DMG_" + Date.now();
    this.damagePoints.push(new DamagePoint(dmgId, street, lat, lng));

    // Recalculate risks for all edges
    this.recalculateRisks();

    // Save and refresh
    await this.saveAndRefresh();

    alert("Titik kerusakan ditandai!");
    e.target.reset();
  },

  async deleteDamage(id) {
    if (!confirm("Tandai jalan ini sebagai normal/kembali aman?")) return;

    // Remove from state
    this.damagePoints = this.damagePoints.filter((dp) => dp.id !== id);

    // Recalculate risks
    this.recalculateRisks();

    // Save and refresh
    await this.saveAndRefresh();
  },

  recalculateRisks() {
    // Reset all edges to normal risk
    this.edges.forEach((edge) => (edge.riskFactor = 1.0));

    // Apply high risk to edges near damage points
    this.damagePoints.forEach((dp) => {
      this.edges.forEach((edge) => {
        const start = this.sites[edge.from];
        const end = this.sites[edge.to];

        if (start && end) {
          // Calculate midpoint of edge
          const midLat = (start.latitude + end.latitude) / 2;
          const midLng = (start.longitude + end.longitude) / 2;

          // Simple distance calculation (in degrees, good enough for proximity check)
          const d = Math.sqrt(Math.pow(midLat - dp.latitude, 2) + Math.pow(midLng - dp.longitude, 2));

          // If damage point is within 0.35 degrees (~39km), mark edge as blocked
          if (d < 0.35) {
            edge.riskFactor = 999.0; // High weight = avoid this edge
          }
        }
      });
    });

    console.log("[RISK] Risk factors recalculated");
  },

  // === FIELD REPORT ===
  async handleFieldReport(e) {
    e.preventDefault();

    const itemName = document.getElementById("req-item").value.trim();
    const siteId = document.getElementById("req-site").value; // ← Posko yang lapor
    const qtyInput = document.getElementById("req-qty")?.value;
    const qty = parseInt(qtyInput) || 1;

    if (!itemName) {
      alert("Nama barang wajib diisi!");
      return;
    }
    if (!siteId) {
      alert("Pilih posko pengungsian terlebih dahulu!");
      return;
    }

    // Cari item existing: match by name + siteId (inventory per posko)
    let item = this.inventory.find((i) => i.itemName?.toLowerCase() === itemName.toLowerCase() && i.siteId === siteId);

    if (!item) {
      // [OK] Buat item baru dengan siteId + stock = qty
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const poskoName = this.sites[siteId]?.siteName || siteId;

      this.inventory.push(new Inventory(tempId, itemName, qty, "Unit", siteId));
      console.log(`[INVENTORY] New item: ${itemName} @ ${poskoName} = ${qty}`);
      alert(`"${itemName}" ditambahkan ke inventori ${poskoName} (stok: ${qty}).`);
    } else {
      // [OK] Tambah stock ke item existing di posko yang sama
      item.currentStock = (item.currentStock || 0) + qty;
      const poskoName = this.sites[siteId]?.siteName || siteId;
      console.log(`[INVENTORY] ${itemName} @ ${poskoName} +${qty} = ${item.currentStock}`);
      alert(`"${itemName}" di ${poskoName} ditambahkan ${qty}. Stok: ${item.currentStock}`);
    }

    await this.saveAndRefresh();
    e.target.reset();
  },
  // === INVENTORY MANAGEMENT ===
  async updateInventory(id, action) {
    // Cari item by itemId dulu
    let item = this.inventory.find((i) => String(i.itemId) === String(id));

    // Jika tidak ditemukan, coba cari by itemName (fallback untuk UUID mismatch)
    if (!item && typeof id === "string" && !id.startsWith("temp_")) {
      // Mungkin id adalah UUID, cari di DB dulu
      const client = window.SupabaseConfig?.client;
      if (client && this.dbConnected) {
        const { dbItem } = await client.from("inventory").select("item_id, item_name, current_stock, unit").eq("item_id", id).maybeSingle();

        if (dbItem) {
          // Sync dari DB ke local state
          item = this.inventory.find((i) => i.itemName === dbItem.item_name);
          if (!item) {
            // Buat baru di local state
            item = new Inventory(dbItem.item_id, dbItem.item_name, dbItem.current_stock, dbItem.unit);
            this.inventory.push(item);
          } else {
            // Update local state dengan data DB
            item.itemId = dbItem.item_id;
            item.currentStock = dbItem.current_stock;
            item.unit = dbItem.unit;
          }
        }
      }
    }

    if (!item) {
      alert("Item tidak ditemukan!");
      return;
    }

    const qtyInput = prompt(`Update stok "${item.itemName}" (saat ini: ${item.currentStock} ${item.unit}):\nMasukkan jumlah:`, "1");

    if (qtyInput === null) return;

    const qtyNum = parseInt(qtyInput);
    if (isNaN(qtyNum) || qtyNum < 0) {
      alert("Jumlah harus berupa angka positif!");
      return;
    }

    // Hitung stok baru
    const newStock = action === "add" ? (item.currentStock || 0) + qtyNum : (item.currentStock || 0) - qtyNum;

    if (newStock < 0) {
      alert(`Stok tidak cukup! Tersedia: ${item.currentStock} ${item.unit}`);
      return;
    }

    // Update local state
    item.currentStock = newStock;

    // Sync ke Supabase
    try {
      const client = window.SupabaseConfig?.client;
      if (client && this.dbConnected) {
        // Update di DB berdasarkan item_name (karena UUID bisa beda)
        const { error } = await client.from("inventory").update({ current_stock: newStock }).eq("item_name", item.itemName);

        if (error) throw error;
        console.log(`[INVENTORY] DB updated: ${item.itemName} = ${newStock}`);
      }
    } catch (err) {
      console.error("[INVENTORY] Gagal sync ke DB:", err);
      // Tetap lanjut, local state sudah update
    }

    // Refresh UI + save cache
    this.renderInventory();
    this.saveToLocalStorage();
  },

  // // === ROUTING LOGIC (Dijkstra + ORS API) ===
  // async calculateSafeRoute() {
  //   const destId = document.getElementById("dest-select").value;
  //   const destination = this.sites[destId];
  //   const start = this.sites["MDN"];

  //   if (!destination) {
  //     alert("⚠️ Pilih tujuan distribusi terlebih dahulu!");
  //     return;
  //   }

  //   // Clear previous route layers
  //   this.clearRouteLayers();

  //   document.getElementById("route-path").innerHTML =
  //     '<span class="text-primary">🔄 Menghitung rute optimal...</span>';

  //   // ORS API Token
  //   const ORS_TOKEN =
  //     "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImY3NjcyNGIxYjE4ODRhODA5ZDUxMmNiNzM3MDFkNjk5IiwiaCI6Im11cm11cjY0In0=";

  //   // Create avoidance polygons for damage points
  //   const offset = 0.00015; // ~16 meters
  //   const avoidPolygonsCoords = this.damagePoints.map((dp) => {
  //     // Show damage area on debug layer
  //     L.rectangle(
  //       [
  //         [dp.latitude - offset, dp.longitude - offset],
  //         [dp.latitude + offset, dp.longitude + offset],
  //       ],
  //       { color: "#e74c3c", weight: 1, fillOpacity: 0.2, dashArray: "5,5" },
  //     ).addTo(this.debugLayer);

  //     // Return polygon for ORS API (note: [lng, lat] order for GeoJSON)
  //     return [
  //       [
  //         [dp.longitude - offset, dp.latitude - offset],
  //         [dp.longitude + offset, dp.latitude - offset],
  //         [dp.longitude + offset, dp.latitude + offset],
  //         [dp.longitude - offset, dp.latitude + offset],
  //         [dp.longitude - offset, dp.latitude - offset],
  //       ],
  //     ];
  //   });

  //   // Helper function to fetch route from ORS
  //   const fetchRoute = async (useAvoidance, startCoord, destCoord) => {
  //     const bodyParams = {
  //       coordinates: [startCoord, destCoord],
  //       elevation: false,
  //       instructions: true,
  //       format: "geojson",
  //     };

  //     if (useAvoidance && avoidPolygonsCoords.length > 0) {
  //       bodyParams.options = {
  //         avoid_polygons: {
  //           type: "MultiPolygon",
  //           coordinates: avoidPolygonsCoords,
  //         },
  //       };
  //     }

  //     const response = await fetch(
  //       "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
  //       {
  //         method: "POST",
  //         headers: {
  //           Accept: "application/json, application/geo+json",
  //           "Content-Type": "application/json",
  //           Authorization: this.ORS_TOKEN,
  //         },
  //         body: JSON.stringify(bodyParams),
  //       },
  //     );

  //     if (!response.ok) {
  //       const errorText = await response.text();
  //       throw new Error(`ORS API error: ${response.status} - ${errorText}`);
  //     }

  //     return await response.json();
  //   };

  //   const startCoord = [start.longitude, start.latitude];
  //   const destCoord = [destination.longitude, destination.latitude];

  //   try {
  //     // Try primary route with damage avoidance
  //     let data = await fetchRoute(true, startCoord, destCoord);
  //     this.drawRoute(data, "#27ae60", false, start, destination, []);
  //   } catch (primaryError) {
  //     console.warn("⚠️ Primary route failed:", primaryError);

  //     document.getElementById("route-path").innerHTML =
  //       `<div class="text-warning fw-bold small">
  //         ⚠️ Jalur utama terblokir.
  //       </div>`;

  //     // Find relay options (intermediate safe sites)
  //     let relayOptions = [];
  //     for (let key in this.sites) {
  //       let posko = this.sites[key];
  //       if (posko.siteId !== "MDN" && posko.siteId !== destId) {
  //         try {
  //           await fetchRoute(
  //             true,
  //             [posko.longitude, posko.latitude],
  //             destCoord,
  //           );
  //           relayOptions.push(posko.siteName);
  //         } catch (err) {
  //           // This relay point also has blocked route
  //         }
  //       }
  //     }

  //     // Try fallback route without avoidance
  //     try {
  //       let fallbackData = await fetchRoute(false, startCoord, destCoord);
  //       this.drawRoute(
  //         fallbackData,
  //         "#e74c3c",
  //         true,
  //         start,
  //         destination,
  //         relayOptions,
  //       );
  //     } catch (fallbackError) {
  //       document.getElementById("route-path").innerHTML =
  //         `<span class="text-danger fw-bold">
  //           ❌ Tujuan terisolir! Semua jalur terblokir.
  //         </span>`;
  //       console.error("❌ All routes failed:", fallbackError);
  //     }
  //   }
  // },

  async calculateSafeRoute() {
    const destId = document.getElementById("dest-select").value;
    const destination = this.sites[destId];
    const start = this.sites["MDN"];

    if (!destination) {
      alert("Pilih tujuan distribusi terlebih dahulu!");
      return;
    } // Clear previous route layers

    this.clearRouteLayers();

    document.getElementById("route-path").innerHTML = '<span class="text-primary">🔄 Menghitung rute optimal...</span>';

    // Create avoidance polygons for damage points

    const offset = 0.00015; // ~16 meters
    const avoidPolygonsCoords = this.damagePoints.map((dp) => {
      // Show damage area on debug layer
      L.rectangle(
        [
          [dp.latitude - offset, dp.longitude - offset],
          [dp.latitude + offset, dp.longitude + offset],
        ],
        { color: "#e74c3c", weight: 1, fillOpacity: 0.2, dashArray: "5,5" },
      ).addTo(this.debugLayer); // Return polygon for ORS API (note: [lng, lat] order for GeoJSON)

      return [
        [
          [dp.longitude - offset, dp.latitude - offset],
          [dp.longitude + offset, dp.latitude - offset],
          [dp.longitude + offset, dp.latitude + offset],
          [dp.longitude - offset, dp.latitude + offset],
          [dp.longitude - offset, dp.latitude - offset],
        ],
      ];
    }); // Helper function to fetch route from ORS

    const fetchRoute = async (useAvoidance, startCoord, destCoord) => {
      const bodyParams = {
        coordinates: [startCoord, destCoord],
        elevation: false,
        instructions: true,
        format: "geojson",
      };

      if (useAvoidance && this.damagePoints.length > 0) {
        // FIX 1: Tangani format GeoJSON dengan benar. ORS kadang reject MultiPolygon untuk 1 array.
        const polyType = this.damagePoints.length === 1 ? "Polygon" : "MultiPolygon";
        const polyCoords = this.damagePoints.length === 1 ? avoidPolygonsCoords[0] : avoidPolygonsCoords;

        bodyParams.options = {
          avoid_polygons: {
            type: polyType,
            coordinates: polyCoords,
          },
        };
      }

      const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
        method: "POST",
        headers: {
          Accept: "application/json, application/geo+json",
          "Content-Type": "application/json",
          Authorization: this.ORS_TOKEN,
        },
        body: JSON.stringify(bodyParams),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ORS API error: ${response.status} - ${errorText}`);
      }
      return await response.json();
    };

    // FIX 2: Helper untuk ngecek apakah koordinat rute benar-benar nabrak area rusak
    const checkRouteSafety = (routeCoords, damagePoints) => {
      // 0.0045 derajat = radius ~500 meter (Sesuai dengan visual L.circle merah di map kamu)
      const dangerThreshold = 0.0045;

      for (let coord of routeCoords) {
        const [lng, lat] = coord;
        for (let dp of damagePoints) {
          const distance = Math.sqrt(Math.pow(lng - dp.longitude, 2) + Math.pow(lat - dp.latitude, 2));
          if (distance < dangerThreshold) {
            return false; // Rute menabrak area rusak!
          }
        }
      }
      return true; // Rute aman sentosa
    };

    const startCoord = [start.longitude, start.latitude];
    const destCoord = [destination.longitude, destination.latitude];

    // === DIJKSTRA FALLBACK SYSTEM ===
    const tryDijkstraRoute = async () => {
      console.log("[DIJKSTRA] Mencari jalur alternatif menggunakan Dijkstra...");
      this.buildGraph();

      const dijkstra = new DijkstraAlgorithm(this.graph);
      const result = dijkstra.computeShortestPath("MDN", destId);

      if (result.path.length > 0 && result.cost < Infinity) {
        console.log(`[DIJKSTRA] Jalur ditemukan: ${result.path.join(" > ")} dengan cost ${result.cost}`);

        // Ganti drawRouteFromPath dengan versi yang pakai ORS per segment
        await this.drawRouteFromPathWithORS(result.path, start, destination);
        return true;
      } else {
        console.warn("[DIJKSTRA] Tidak ada jalur aman tersedia");
        return false;
      }
    };

    // === STEP 1: Try ORS with avoidance ===
    try {
      let data = await fetchRoute(true, startCoord, destCoord);
      const routeCoords = data.features[0].geometry.coordinates;
      const isSafe = checkRouteSafety(routeCoords, this.damagePoints);

      if (isSafe) {
        this.drawRoute(data, "#27ae60", false, start, destination, []);
      } else {
        console.warn("[ROUTE] ORS route intersects damage zone, trying Dijkstra...");
        if (!tryDijkstraRoute()) {
          this.drawRoute(data, "#e74c3c", true, start, destination, []);
        }
      }
    } catch (primaryError) {
      console.warn("[ROUTE] ORS primary failed:", primaryError.message);

      // === STEP 2: Try ORS fallback without avoidance ===
      try {
        let fallbackData = await fetchRoute(false, startCoord, destCoord);
        const routeCoords = fallbackData.features[0].geometry.coordinates;
        const isSafe = checkRouteSafety(routeCoords, this.damagePoints);

        if (isSafe) {
          this.drawRoute(fallbackData, "#27ae60", false, start, destination, []);
        } else {
          console.warn("[ROUTE] Fallback route also dangerous, trying Dijkstra...");
          if (!tryDijkstraRoute()) {
            this.drawRoute(fallbackData, "#e74c3c", true, start, destination, []);
          }
        }
      } catch (fallbackError) {
        console.warn("[ROUTE] ORS fallback failed:", fallbackError.message);
        console.log("[DIJKSTRA] Menggunakan Dijkstra sebagai routing utama...");

        if (!tryDijkstraRoute()) {
          document.getElementById("route-path").innerHTML = `<span class="text-danger fw-bold">
             Tujuan terisolir! Semua jalur terblokir.
           </span>`;
        }
      }
    }
  },

  buildGraph() {
    if (!this.graph) {
      this.graph = new RoadGraph();
    } else {
      this.graph.adjacencyList = {};
    }

    Object.keys(this.sites).forEach((id) => this.graph.addNode(id));

    this.edges.forEach((e) => {
      const isNearDamage = this.isEdgeNearDamage(e);
      const riskFactor = isNearDamage ? 999 : e.riskFactor;
      this.graph.addEdge(new RoadEdge(e.from, e.to, e.distance, riskFactor));
    });

    console.log(`[GRAPH] Built: ${Object.keys(this.graph.adjacencyList).length} nodes, ${this.edges.length} edges`);
  },

  isEdgeNearDamage(edge, threshold = 0.01) {
    const siteFrom = this.sites[edge.from];
    const siteTo = this.sites[edge.to];

    if (!siteFrom || !siteTo) return false;

    const midLat = (siteFrom.latitude + siteTo.latitude) / 2;
    const midLng = (siteFrom.longitude + siteTo.longitude) / 2;

    for (let dp of this.damagePoints) {
      const distance = Math.sqrt(
        Math.pow(midLat - dp.latitude, 2) + Math.pow(midLng - dp.longitude, 2)
      );
      if (distance < threshold) {
        return true;
      }
    }
    return false;
  },

  drawRouteFromPath(pathIds, totalCost, start, dest) {
    const pathCoords = [];
    let totalDistance = 0;

    for (let i = 0; i < pathIds.length; i++) {
      const site = this.sites[pathIds[i]];
      if (site) {
        pathCoords.push([site.latitude, site.longitude]);
      }

      if (i < pathIds.length - 1) {
        const edge = this.edges.find(
          (e) =>
            (e.from === pathIds[i] && e.to === pathIds[i + 1]) ||
            (e.from === pathIds[i + 1] && e.to === pathIds[i])
        );
        if (edge) {
          totalDistance += edge.distance;
        }
      }
    }

    const polyline = L.polyline(pathCoords, {
      color: "#27ae60",
      weight: 6,
      opacity: 0.85,
      lineCap: "round",
    }).addTo(this.map);

    this.map.fitBounds(polyline.getBounds(), {
      padding: [50, 50],
    });

    this.currentRouteLayer = polyline;
    this.currentRouteCoords = pathCoords;

    const distanceKm = totalDistance.toFixed(2);
    const estDuration = Math.round((totalDistance / 60) * 60);

    let uiHTML = `
      <div class="text-success fw-bold mb-1"><i class="bi bi-check-circle me-1"></i> RUTE AMAN (Dijkstra)</div>
      <div class="small mb-1">${start.siteName} <i class="bi bi-arrow-right mx-1"></i> ${dest.siteName}</div>
      <div class="small text-muted">${distanceKm} km | Est: ${estDuration} menit</div>
      <div class="small text-muted mt-1">Via: ${pathIds.map(id => this.sites[id]?.siteName || id).join(" <i class='bi bi-chevron-right mx-1'></i> ")}</div>
    `;

    document.getElementById("route-path").innerHTML = uiHTML;
    document.getElementById("route-instructions").innerHTML = "";
  },

  // === DRAW ROUTE FROM DIJKSTRA PATH WITH ORS (REAL ROAD GEOMETRY) ===
  async drawRouteFromPathWithORS(pathIds, start, dest) {
    console.log("[DIJKSTRA-ORS] Drawing route for path:", pathIds.join(" → "));

    if (pathIds.length < 2) {
      console.warn("[DIJKSTRA-ORS] Path too short");
      return;
    }

    const allCoords = [];
    let totalDistance = 0;
    let totalDuration = 0;

    // Check if a coordinate is in any damage zone
    const isInDamageZone = (lat, lng) => {
      const threshold = 0.003; // ~330 meters
      for (let dp of this.damagePoints) {
        const dist = Math.sqrt(Math.pow(lat - dp.latitude, 2) + Math.pow(lng - dp.longitude, 2));
        if (dist < threshold) return true;
      }
      return false;
    };

    // Check if a route goes through damage zone
    const doesRoutePassDamage = (coords) => {
      for (let coord of coords) {
        if (isInDamageZone(coord[0], coord[1])) return true;
      }
      return false;
    };

    // Build avoidance polygons for ORS
    const buildAvoidance = () => {
      if (this.damagePoints.length === 0) return null;
      const offset = 0.003; // ~300 meters buffer
      const polygons = this.damagePoints.map((dp) => [
        [
          [dp.longitude - offset, dp.latitude - offset],
          [dp.longitude + offset, dp.latitude - offset],
          [dp.longitude + offset, dp.latitude + offset],
          [dp.longitude - offset, dp.latitude + offset],
          [dp.longitude - offset, dp.latitude - offset],
        ],
      ]);
      return {
        avoid_polygons: {
          type: this.damagePoints.length === 1 ? "Polygon" : "MultiPolygon",
          coordinates: this.damagePoints.length === 1 ? polygons[0] : polygons,
        },
      };
    };

    // Find alternative waypoint that avoids all damage zones
    const findSafeWaypoint = (fromLat, fromLng, toLat, toLng) => {
      // Try points to the sides of the direct line
      const midLat = (fromLat + toLat) / 2;
      const midLng = (fromLng + toLng) / 2;

      // Calculate perpendicular offset
      const dx = toLng - fromLng;
      const dy = toLat - fromLat;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / len * 0.02; // ~2km perpendicular offset
      const perpY = dx / len * 0.02;

      const alternatives = [
        [midLng + perpX, midLat + perpY], // Right
        [midLng - perpX, midLat - perpY], // Left
        [midLng + perpX * 0.5, midLat + perpY * 0.5],
        [midLng - perpX * 0.5, midLat - perpY * 0.5],
      ];

      // Find first point that doesn't pass through damage
      for (const alt of alternatives) {
        if (!isInDamageZone(alt[1], alt[0])) {
          return alt;
        }
      }

      return null; // No safe waypoint found
    };

    // Process each segment
    for (let i = 0; i < pathIds.length - 1; i++) {
      const fromSite = this.sites[pathIds[i]];
      const toSite = this.sites[pathIds[i + 1]];

      if (!fromSite || !toSite) continue;

      console.log(`[DIJKSTRA-ORS] Processing: ${fromSite.siteName} → ${toSite.siteName}`);

      const fromCoord = [fromSite.longitude, fromSite.latitude];
      const toCoord = [toSite.longitude, toSite.latitude];

      let segmentCoords = null;
      let segmentDistance = 0;
      let segmentDuration = 0;
      let usedAlternative = false;

      // Strategy 1: Try ORS with avoidance
      if (!segmentCoords && this.damagePoints.length > 0) {
        try {
          const response = await fetch(
            "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
            {
              method: "POST",
              headers: {
                "Accept": "application/json, application/geo+json",
                "Content-Type": "application/json",
                "Authorization": this.ORS_TOKEN,
              },
              body: JSON.stringify({
                coordinates: [fromCoord, toCoord],
                elevation: false,
                format: "geojson",
                options: buildAvoidance(),
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.features && data.features[0]) {
              const coords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
              if (!doesRoutePassDamage(coords)) {
                segmentCoords = coords;
                segmentDistance = data.features[0].properties.summary?.distance || 0;
                segmentDuration = data.features[0].properties.summary?.duration || 0;
                console.log(`[DIJKSTRA-ORS] Strategy 1 (avoidance) succeeded`);
              } else {
                console.log(`[DIJKSTRA-ORS] Strategy 1 failed - route still passes damage zone`);
              }
            }
          }
        } catch (err) {
          console.warn(`[DIJKSTRA-ORS] Strategy 1 failed:`, err.message);
        }
      }

      // Strategy 2: Try with safe waypoint
      if (!segmentCoords) {
        const safeWaypoint = findSafeWaypoint(
          fromSite.latitude, fromSite.longitude,
          toSite.latitude, toSite.longitude
        );

        if (safeWaypoint) {
          console.log(`[DIJKSTRA-ORS] Trying via safe waypoint: [${safeWaypoint[1]}, ${safeWaypoint[0]}]`);

          try {
            // First leg: from -> waypoint
            const response1 = await fetch(
              "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
              {
                method: "POST",
                headers: {
                  "Accept": "application/json, application/geo+json",
                  "Content-Type": "application/json",
                  "Authorization": this.ORS_TOKEN,
                },
                body: JSON.stringify({
                  coordinates: [fromCoord, safeWaypoint],
                  elevation: false,
                  format: "geojson",
                }),
              }
            );

            // Second leg: waypoint -> to
            const response2 = await fetch(
              "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
              {
                method: "POST",
                headers: {
                  "Accept": "application/json, application/geo+json",
                  "Content-Type": "application/json",
                  "Authorization": this.ORS_TOKEN,
                },
                body: JSON.stringify({
                  coordinates: [safeWaypoint, toCoord],
                  elevation: false,
                  format: "geojson",
                }),
              }
            );

            if (response1.ok && response2.ok) {
              const data1 = await response1.json();
              const data2 = await response2.json();

              if (data1.features && data1.features[0] && data2.features && data2.features[0]) {
                const coords1 = data1.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
                const coords2 = data2.features[0].geometry.coordinates.map(c => [c[1], c[0]]);

                // Validate both legs don't pass through damage zone
                if (doesRoutePassDamage(coords1) || doesRoutePassDamage(coords2)) {
                  console.log(`[DIJKSTRA-ORS] Strategy 2 failed - route still passes damage zone`);
                } else {
                  // Combine
                  segmentCoords = [...coords1, ...coords2];
                  segmentDistance = (data1.features[0].properties.summary?.distance || 0) +
                                    (data2.features[0].properties.summary?.distance || 0);
                  segmentDuration = (data1.features[0].properties.summary?.duration || 0) +
                                    (data2.features[0].properties.summary?.duration || 0);
                  usedAlternative = true;
                  console.log(`[DIJKSTRA-ORS] Strategy 2 (via waypoint) succeeded`);
                }
              }
            }
          } catch (err) {
            console.warn(`[DIJKSTRA-ORS] Strategy 2 failed:`, err.message);
          }
        }
      }

      // Strategy 3: Try via multiple intermediate points
      if (!segmentCoords) {
        console.log(`[DIJKSTRA-ORS] Trying multi-point route...`);

        // Create intermediate points at 1/3 and 2/3 of the route
        const waypoints = [
          fromCoord,
          [fromCoord[0] + (toCoord[0] - fromCoord[0]) * 2 / 3, fromCoord[1] + (toCoord[1] - fromCoord[1]) * 2 / 3],
          [fromCoord[0] + (toCoord[0] - fromCoord[0]) / 3, fromCoord[1] + (toCoord[1] - fromCoord[1]) / 3],
          toCoord,
        ].map(c => {
          // Adjust each waypoint to be outside damage zones if needed
          const wp = { lng: c[0], lat: c[1] };
          for (let dp of this.damagePoints) {
            const dist = Math.sqrt(Math.pow(c[1] - dp.latitude, 2) + Math.pow(c[0] - dp.longitude, 2));
            if (dist < 0.01) {
              // Move waypoint away from damage
              wp.lng += (c[0] > dp.longitude ? 0.01 : -0.01);
              wp.lat += (c[1] > dp.latitude ? 0.01 : -0.01);
            }
          }
          return [wp.lng, wp.lat];
        });

        try {
          const response = await fetch(
            "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
            {
              method: "POST",
              headers: {
                "Accept": "application/json, application/geo+json",
                "Content-Type": "application/json",
                "Authorization": this.ORS_TOKEN,
              },
              body: JSON.stringify({
                coordinates: waypoints,
                elevation: false,
                format: "geojson",
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.features && data.features[0]) {
              const coords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
              if (!doesRoutePassDamage(coords)) {
                segmentCoords = coords;
                segmentDistance = data.features[0].properties.summary?.distance || 0;
                segmentDuration = data.features[0].properties.summary?.duration || 0;
                usedAlternative = true;
                console.log(`[DIJKSTRA-ORS] Strategy 3 (multi-point) succeeded`);
              }
            }
          }
        } catch (err) {
          console.warn(`[DIJKSTRA-ORS] Strategy 3 failed:`, err.message);
        }
      }

      // Strategy 4: Direct ORS without avoidance (last resort)
      if (!segmentCoords) {
        console.log(`[DIJKSTRA-ORS] Using direct route (no avoidance)...`);

        try {
          const response = await fetch(
            "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
            {
              method: "POST",
              headers: {
                "Accept": "application/json, application/geo+json",
                "Content-Type": "application/json",
                "Authorization": this.ORS_TOKEN,
              },
              body: JSON.stringify({
                coordinates: [fromCoord, toCoord],
                elevation: false,
                format: "geojson",
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.features && data.features[0]) {
              const coords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
              if (doesRoutePassDamage(coords)) {
                console.log(`[DIJKSTRA-ORS] Strategy 4 failed - route still passes damage zone`);
              } else {
                segmentCoords = coords;
                segmentDistance = data.features[0].properties.summary?.distance || 0;
                segmentDuration = data.features[0].properties.summary?.duration || 0;
                console.log(`[DIJKSTRA-ORS] Strategy 4 (direct) used`);
              }
            }
          }
        } catch (err) {
          console.warn(`[DIJKSTRA-ORS] Strategy 4 failed:`, err.message);
        }
      }

      // If still no coords, skip this segment
      if (!segmentCoords) {
        console.warn(`[DIJKSTRA-ORS] All strategies failed for segment ${fromSite.siteName} → ${toSite.siteName}`);
        continue;
      }

      // Add to route
      if (allCoords.length > 0) {
        allCoords.pop();
      }
      allCoords.push(...segmentCoords);

      totalDistance += segmentDistance;
      totalDuration += segmentDuration;

      if (usedAlternative) {
        console.log(`[DIJKSTRA-ORS] Segment used alternative routing`);
      }
    }

    console.log(`[DIJKSTRA-ORS] Done. ${allCoords.length} points`);

    if (allCoords.length < 2) {
      document.getElementById("route-path").innerHTML = `
        <div class="text-warning fw-bold mb-1">
          <i class="bi bi-exclamation-triangle me-1"></i> RUTE TERBATAS
        </div>
        <div class="small text-muted">Tidak ada jalur aman yang tersedia.</div>
      `;
      return;
    }

    // Clean duplicates
    const cleanCoords = [allCoords[0]];
    for (let i = 1; i < allCoords.length; i++) {
      const prev = cleanCoords[cleanCoords.length - 1];
      const curr = allCoords[i];
      if (Math.abs(prev[0] - curr[0]) > 0.00001 || Math.abs(prev[1] - curr[1]) > 0.00001) {
        cleanCoords.push(curr);
      }
    }

    // Remove existing layer
    if (this.currentRouteLayer) {
      this.map.removeLayer(this.currentRouteLayer);
    }

    // Draw
    this.currentRouteLayer = L.polyline(cleanCoords, {
      color: "#27ae60",
      weight: 6,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(this.map);

    this.map.fitBounds(this.currentRouteLayer.getBounds(), { padding: [50, 50] });
    this.currentRouteCoords = cleanCoords;

    // UI
    const distanceKm = (totalDistance / 1000).toFixed(2);
    const durationMin = Math.round(totalDuration / 60);

    let uiHTML = `
      <div class="text-success fw-bold mb-1">
        <i class="bi bi-check-circle me-1"></i> RUTE AMAN DITEMUKAN
      </div>
      <div class="small mb-1">${start.siteName} <i class="bi bi-arrow-right mx-1"></i> ${dest.siteName}</div>
      <div class="small text-muted">${distanceKm} km | Est: ${durationMin} menit</div>
      <div class="small text-muted mt-1">Via: ${pathIds.map(id => this.sites[id]?.siteName || id).join(" → ")}</div>
    `;

    document.getElementById("route-path").innerHTML = uiHTML;
    document.getElementById("route-instructions").innerHTML = "";
  },

  clearRouteLayers() {
    if (this.currentRouteLayer) this.map.removeLayer(this.currentRouteLayer);
    if (this.debugLayer) this.map.removeLayer(this.debugLayer);
    if (this.hoverLayer) this.map.removeLayer(this.hoverLayer);

    this.debugLayer = L.layerGroup().addTo(this.map);
    this.clearHighlight();
    this.clearInteractionLayers();
  },

  // === ROUTE DRAWING & UI ===
  drawRoute(data, color, isDanger, start, dest, relayOptions) {
    // Draw route on map
    this.currentRouteLayer = L.geoJSON(data, {
      style: {
        color: color,
        weight: 6,
        opacity: 0.85,
        dashArray: isDanger ? "10, 10" : "",
        lineCap: "round",
      },
    }).addTo(this.map);

    this.map.fitBounds(this.currentRouteLayer.getBounds(), {
      padding: [50, 50],
    });

    // Extract coordinates for interaction
    this.currentRouteCoords = data.features[0].geometry.coordinates.map((c) => [c[1], c[0]]);

    // Route summary
    const s = data.features[0].properties.summary;
    const distanceKm = (s.distance / 1000).toFixed(2);
    const durationMin = Math.round(s.duration / 60);

    // Build UI HTML
    let uiHTML = `
      <div class="${isDanger ? "text-danger" : "text-success"} fw-bold mb-1">
        ${isDanger ? "<i class='bi bi-exclamation-triangle me-1'></i> JALUR DARURAT" : "<i class='bi bi-check-circle me-1'></i> RUTE AMAN"}
      </div>
      <div class="small mb-1">${start.siteName} <i class="bi bi-arrow-right mx-1"></i> ${dest.siteName}</div>
      <div class="small text-muted">${distanceKm} km | Est: ${durationMin} menit</div>
    `;

    // Add relay recommendations if dangerous route
    // if (isDanger && relayOptions.length > 0) {
    //   uiHTML += `
    //     <div class="mt-3 p-2 border border-warning rounded bg-warning bg-opacity-10">
    //       <div class="small fw-bold text-dark mb-1">💡 Rekomendasi Distribusi Estafet:</div>
    //       <div class="small text-dark">
    //         Jalur langsung terblokir.
    //       </div>
    //     </div>
    //   `;
    // } else if (isDanger) {
    //   uiHTML += `<div class="mt-2 small text-danger fw-bold">⚠️ Tidak ada posko perantara dengan akses aman.</div>`;
    // }

    document.getElementById("route-path").innerHTML = uiHTML;

    // Build turn-by-turn instructions
    this.renderRouteInstructions(data, isDanger);

    // Alert for dangerous routes
    if (isDanger) {
      setTimeout(() => {
        alert("Jalur aman tidak tersedia!");
      }, 100);
    }
  },

  renderRouteInstructions(data, isDanger) {
    const instrContainer = document.getElementById("route-instructions");
    const segments = data.features[0].properties.segments;

    if (!segments?.[0]?.steps) {
      instrContainer.style.display = "none";
      return;
    }

    let stepsHTML = '<ul class="list-group list-group-flush border rounded shadow-sm">';

    segments[0].steps.forEach((step, index) => {
      const distText = step.distance > 1000 ? (step.distance / 1000).toFixed(1) + " km" : Math.round(step.distance) + " m";

      const startIdx = step.way_points[0];
      const endIdx = step.way_points[1];

      // Highlight colors
      const hlColor = isDanger ? "#ffecb3" : "#d4edda";
      const hlBorder = isDanger ? "#ffc107" : "#28a745";

      stepsHTML += `
        <li id="step-item-${index}" 
            class="list-group-item d-flex justify-content-between align-items-center p-2 step-item"
            style="font-size: 13px; cursor: pointer; transition: all 0.15s; border-left: 4px solid transparent;"
            onmouseenter="this.style.backgroundColor='${hlColor}'; this.style.borderLeftColor='${hlBorder}'; window.controller.highlightStep(${startIdx}, ${endIdx})"
            onmouseleave="this.style.backgroundColor='#ffffff'; this.style.borderLeftColor='transparent'; window.controller.clearHighlight()">
          <span class="me-2">${index + 1}.</span>
          <span class="flex-grow-1">${step.instruction}</span>
          <span class="badge bg-secondary rounded-pill ms-2" style="min-width: 60px;">${distText}</span>
        </li>
      `;

      // Create invisible interaction layer for map hover
      const segmentCoords = this.currentRouteCoords.slice(startIdx, endIdx + 1);
      const invisibleLine = L.polyline(segmentCoords, {
        color: "white",
        weight: 35,
        opacity: 0,
        interactive: true,
      }).addTo(this.map);

      // Map hover -> highlight UI
      invisibleLine.on("mouseover", () => {
        this.highlightStep(startIdx, endIdx);
        const li = document.getElementById(`step-item-${index}`);
        if (li) {
          li.style.backgroundColor = hlColor;
          li.style.borderLeftColor = hlBorder;
          li.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });

      // Map mouseout -> clear highlight
      invisibleLine.on("mouseout", () => {
        this.clearHighlight();
        const li = document.getElementById(`step-item-${index}`);
        if (li) {
          li.style.backgroundColor = "#ffffff";
          li.style.borderLeftColor = "transparent";
        }
      });

      this.interactionLayers.push(invisibleLine);
    });

    stepsHTML += "</ul>";
    instrContainer.innerHTML = stepsHTML;
    instrContainer.style.display = "block";
  },

  clearInteractionLayers() {
    this.interactionLayers.forEach((layer) => {
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    });
    this.interactionLayers = [];
  },

  // === ROUTE HIGHLIGHT ON HOVER ===
  highlightStep(startIdx, endIdx) {
    this.clearHighlight();

    if (!this.currentRouteCoords?.length) return;

    const segmentCoords = this.currentRouteCoords.slice(startIdx, endIdx + 1);

    // Create dedicated pane for highlight (above route, below markers)
    if (!this.map.getPane("hoverPane")) {
      this.map.createPane("hoverPane");
      this.map.getPane("hoverPane").style.zIndex = 650;
      this.map.getPane("hoverPane").style.pointerEvents = "none";
    }

    this.hoverLayer = L.polyline(segmentCoords, {
      color: "#ff9f43",
      weight: 14,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
      pane: "hoverPane",
    }).addTo(this.map);
  },

  clearHighlight() {
    if (this.hoverLayer) {
      this.map.removeLayer(this.hoverLayer);
      this.hoverLayer = null;
    }
  },

  // === RENDER UI ===
  renderAll() {
    // Clear map markers (preserve tiles and route layers)
    this.map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Circle || layer instanceof L.Rectangle) {
        if (layer !== this.currentRouteLayer && layer !== this.debugLayer) {
          this.map.removeLayer(layer);
        }
      }
    });

    // Render sites
    this.renderSites();

    // Render damage points
    this.renderDamagePoints();

    // Update dropdowns
    this.updateDropdowns();

    // Render inventory table
    this.renderInventory();
  },

  renderSites() {
    const siteListBody = document.getElementById("site-list-body");
    if (!siteListBody) return;

    siteListBody.innerHTML = "";

    Object.values(this.sites).forEach((s) => {
      // Add marker to map
      const marker = L.marker([s.latitude, s.longitude]).addTo(this.map);

      // Custom popup content
      const popupContent = `
        <b>${s.siteName}</b><br>
        <small class="text-muted">ID: ${s.siteId}</small><br>
        <small>Kapasitas: ${s.capacity} orang</small>
      `;
      marker.bindPopup(popupContent);

      // Open popup for MDN by default
      if (s.siteId === "MDN") {
        marker.bindPopup(`<b><i class="bi bi-building"></i> Pusat Logistik (Medan)</b>`).openPopup();
      }

      // Add to admin list (exclude MDN)
      if (s.siteId !== "MDN" && siteListBody) {
        siteListBody.innerHTML += `
          <tr>
            <td>${s.siteName}</td>
            <td>
              <button class="btn btn-xs btn-outline-danger py-0 px-2" 
                      onclick="controller.deleteSite('${s.siteId}')"
                      title="Hapus posko"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `;
      }
    });
  },

  renderDamagePoints() {
    const damageListBody = document.getElementById("damage-list-body");
    if (!damageListBody) return;

    damageListBody.innerHTML = "";

    // Custom red icon for damage markers
    const redIcon = new L.Icon({
      iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });

    this.damagePoints.forEach((dp) => {
      // Add marker with circle radius
      L.marker([dp.latitude, dp.longitude], { icon: redIcon }).addTo(this.map).bindPopup(`<b><i class="bi bi-exclamation-triangle"></i> AREA RUSAK</b><br>${dp.street}`);

      L.circle([dp.latitude, dp.longitude], {
        color: "#e74c3c",
        weight: 1,
        fillOpacity: 0.1,
        radius: 500,
      }).addTo(this.map);

      // Add to admin list
      damageListBody.innerHTML += `
        <tr>
          <td>${dp.street}</td>
          <td>
            <button class="btn btn-xs btn-outline-success py-0 px-2" 
                    onclick="controller.deleteDamage('${dp.id}')"
                    title="Tandai sebagai normal"><i class="bi bi-check"></i></button>
          </td>
        </tr>
      `;
    });
  },

  updateDropdowns() {
    console.log("[UI] updateDropdowns() dipanggil");

    // Filter & buat option HTML
    const options = Object.values(this.sites)
      .filter((s) => s.siteId !== "MDN")
      .map((s) => {
        console.log(`[UI] Menambahkan: ${s.siteName} -> value="${s.siteId}"`);
        return `<option value="${s.siteId}">${s.siteName}</option>`;
      })
      .join("");

    const total = Object.values(this.sites).length - 1;
    console.log(`[UI] Total option yang dibuat: ${total}`);

    // Update DOM
    const destSelect = document.getElementById("dest-select");
    const reqSite = document.getElementById("req-site");

    if (destSelect) {
      destSelect.innerHTML = `<option value="">Pilih posko tujuan...</option>` + options;
      console.log("[UI] dest-select berhasil diupdate");
    } else {
      console.warn("[UI] Element #dest-select TIDAK DITEMUKAN di DOM!");
    }

    if (reqSite) {
      reqSite.innerHTML = `<option value="">Pilih posko...</option>` + options;
      console.log("[UI] req-site berhasil diupdate");
    } else {
      console.warn("[UI] Element #req-site TIDAK DITEMUKAN di DOM!");
    }
  },
  renderInventory() {
    const invBody = document.getElementById("inv-body");
    if (!invBody) return;

    if (!this.inventory || this.inventory.length === 0) {
      invBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Belum ada data inventori</td></tr>`;
      return;
    }

    invBody.innerHTML = this.inventory
      .map((i) => {
        const safeId = String(i.itemId || "").replace(/'/g, "\\'");
        const name = i.itemName || "Unknown";
        const stock = parseInt(i.currentStock) || 0;
        const unit = i.unit || "unit";

        // ✅ Tampilkan nama posko (jika ada siteId)
        const poskoName = i.siteId && this.sites[i.siteId] ? this.sites[i.siteId].siteName : i.siteId || "Gudang Utama";

        return `
    <tr>
      <td>${name}</td>
      <td><small class="text-muted">${poskoName}</small></td>  <!-- [OK] Kolom Posko -->
      <td class="fw-bold text-success">${stock}</td>
      <td><small class="text-muted">${unit}</small></td>
      <td>
        <button class="btn btn-sm btn-outline-success py-0 px-2" 
                onclick="controller.updateInventory('${safeId}', 'add')" 
                title="Tambah stok">+</button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2 ms-1" 
                onclick="controller.updateInventory('${safeId}', 'reduce')" 
                title="Kurangi stok"><i class="bi bi-dash"></i></button>
      </td>
    </tr>`;
      })
      .join("");
  },
  // === PRINT REPORT ===
  prepareReport() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Set dates
    document.getElementById("print-date").innerText = dateStr;
    document.getElementById("sign-date").innerText = dateStr;

    // 1. Inventory table
    const invBody = document.getElementById("print-inv-body");
    invBody.innerHTML =
      this.inventory.length > 0
        ? this.inventory
            .map((i) => {
              const posko = i.siteId && this.sites[i.siteId] ? this.sites[i.siteId].siteName : i.siteId || "Gudang Utama";
              return `
        <tr>
          <td>${i.itemName}</td>
          <td>${posko}</td>  <!-- [OK] Kolom Posko -->
          <td class="text-end fw-bold">${i.currentStock}</td>
          <td>${i.unit}</td>
        </tr>`;
            })
            .join("")
        : `<tr><td colspan="4" class="text-center text-muted">Tidak ada data</td></tr>`;

    // 2. Sites table
    const siteBody = document.getElementById("print-site-body");
    siteBody.innerHTML =
      Object.values(this.sites).length > 0
        ? Object.values(this.sites)
            .map(
              (s) => `
          <tr>
            <td>${s.siteId}</td>
            <td>${s.siteName}</td>
            <td class="text-muted small">${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}</td>
          </tr>
        `,
            )
            .join("")
        : `<tr><td colspan="3" class="text-center text-muted">Tidak ada data</td></tr>`;

    // 3. Damage points table
    const dmgBody = document.getElementById("print-dmg-body");
    dmgBody.innerHTML =
      this.damagePoints.length > 0
        ? this.damagePoints
            .map(
              (d) => `
          <tr>
            <td>${d.street}</td>
            <td class="text-muted small">${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}</td>
            <td><span class="badge bg-danger">Rusak</span></td>
          </tr>
        `,
            )
            .join("")
        : `<tr><td colspan="3" class="text-center text-muted">Tidak ada laporan kerusakan</td></tr>`;

    // 4. Route info
    const routeText = document.getElementById("route-path").innerText;
    document.getElementById("print-route-info").innerText = routeText && routeText !== "-" ? routeText : "Belum ada rute yang dihitung.";

    // Trigger print
    setTimeout(() => {
      window.print();
    }, 100);
  },
};

// === GLOBAL ERROR HANDLER ===
window.addEventListener('error', function(e) {
  console.error('[GLOBAL ERROR]', e.message, 'at', e.filename, 'line', e.lineno);
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.style.display = "none";
});

// === GLOBAL INITIALIZATION ===
window.controller = controller;

function startApp() {
  console.log('[INIT] Starting application...');
  try {
    controller.init();
  } catch (err) {
    console.error('[INIT] Startup error:', err);
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.style.display = "none";
    // Show login as fallback
    document.getElementById("login-overlay").style.display = "flex";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
