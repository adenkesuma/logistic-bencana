// Representasi Lokasi
class RefugeeSite {
  constructor(id, name, lat, lng, capacity) {
    this.siteId = id;
    this.siteName = name;
    this.latitude = lat;
    this.longitude = lng;
    this.capacity = capacity;
  }
}

// Representasi Titik Kerusakan
class DamagePoint {
  constructor(id, street, lat, lng) {
    this.id = id;
    this.street = street;
    this.latitude = lat;
    this.longitude = lng;
  }
}

// Manajemen Inventori Terintegrasi

class Inventory {
  constructor(itemId, itemName, stock, unit, siteId = null) {
    // ← Tambah parameter siteId
    this.itemId = itemId;
    this.itemName = itemName;
    this.currentStock = parseInt(stock) || 0;
    this.unit = unit;
    this.siteId = siteId; // ← Simpan posko terkait
  }

  addStock(qty) {
    this.currentStock += parseInt(qty);
    return true;
  }

  reduceStock(qty) {
    if (this.currentStock >= qty) {
      this.currentStock -= parseInt(qty);
      return true;
    }
    return false;
  }
}

// Struktur Data Graf
class RoadEdge {
  constructor(from, to, distance, riskFactor = 1.0) {
    this.from = from;
    this.to = to;
    this.distance = distance;
    this.riskFactor = riskFactor;
  }
  get weight() {
    return this.distance * this.riskFactor;
  }
}

class RoadGraph {
  constructor() {
    this.adjacencyList = {};
  }
  addNode(id) {
    if (!this.adjacencyList[id]) this.adjacencyList[id] = [];
  }
  addEdge(edge) {
    this.adjacencyList[edge.from].push({ node: edge.to, weight: edge.weight });
    this.adjacencyList[edge.to].push({ node: edge.from, weight: edge.weight });
  }
}
