class DijkstraAlgorithm {
  // Konstruktor untuk menerima objek graph (peta posko dan jalan)
  constructor(graph) {
    this.graph = graph;
  }

  // Fungsi utama untuk mencari jalur terpendek dari titik awal ke tujuan
  computeShortestPath(source, destination) {
    let d = {}; // Objek untuk menyimpan jarak terpendek dari source ke setiap node
    let prev = {}; // Objek untuk menyimpan node sebelumnya (untuk melacak rute)
    // Q adalah set 'antrean' semua node yang belum dikunjungi
    let Q = new Set(Object.keys(this.graph.adjacencyList));

    // Looping awal: Set semua jarak ke Infinity dan previous ke null
    for (let n in this.graph.adjacencyList) {
      d[n] = Infinity; // Awalnya dianggap tak terhingga karena belum dicek
      prev[n] = null; // Belum ada jalur yang tercatat
    }
    d[source] = 0; // Jarak dari titik awal ke dirinya sendiri adalah 0

    // Selama masih ada node di dalam antrean Q...
    while (Q.size > 0) {
      // Cari node 'u' dalam antrean yang memiliki nilai d[u] terkecil
      let u = [...Q].reduce((min, n) => (d[n] < d[min] ? n : min));

      // Jika jarak terkecil adalah Infinity (tak terjangkau) atau sudah sampai tujuan, stop loop
      if (d[u] === Infinity || u === destination) break;

      // Hapus node 'u' dari antrean karena akan segera diproses (mark as visited)
      Q.delete(u);

      // // Cek semua tetangga (neighbor) yang terhubung langsung dengan node 'u'
      // for (let neighbor of this.graph.adjacencyList[u]) {
      //   // Hitung bobot alternatif: jarak ke 'u' ditambah bobot jalan ke tetangga
      //   // Secara matematis: $alt = d[u] + weight(u, v)$
      //   let alt = d[u] + neighbor.weight;

      //   // RELAKSASI: Jika jalur baru (alt) lebih kecil dari jarak yang tercatat sebelumnya...
      //   if (alt < d[neighbor.node]) {
      //     d[neighbor.node] = alt; // Update jarak terpendek ke node tetangga tersebut
      //     prev[neighbor.node] = u; // Catat bahwa jalur terbaik ke tetangga ini adalah melalui 'u'
      //   }
      // }

      // revisi
      for (let neighbor of this.graph.adjacencyList[u]) {
        // [WARN] SKIP jalan rusak total
        if (neighbor.weight >= 999) continue;

        let alt = d[u] + neighbor.weight;

        if (alt < d[neighbor.node]) {
          d[neighbor.node] = alt;
          prev[neighbor.node] = u;
        }
      }
    }
    // Kembalikan objek berisi urutan jalur (path) dan total biaya/jaraknya
    return { path: this.reconstruct(prev, destination), cost: d[destination] };
  }

  // Fungsi pembantu untuk menyusun ulang urutan node dari akhir ke awal
  reconstruct(prev, end) {
    let path = []; // Array untuk menyimpan urutan posko
    let curr = end; // Mulai pelacakan dari titik tujuan

    // Melakukan backtrack (mundur) menggunakan catatan 'prev' sampai tidak ada node lagi
    while (curr) {
      path.unshift(curr); // Masukkan node ke urutan paling depan array
      curr = prev[curr]; // Mundur ke node sebelumnya
    }
    return path; // Contoh hasil: ['MDN', 'POS_A', 'POS_B']
  }
}
