const STORAGE_KEY = 'web-joki-db';
const AUTH_KEY = 'web-joki-auth';
const APP_VERSION = 'v1';


const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCA0I4Ns_pX0kMOeHVcDoJHtwVLL5H81WM',
  authDomain: 'web-joki-216fc.firebaseapp.com',
  projectId: 'web-joki-216fc',
  storageBucket: 'web-joki-216fc.firebasestorage.app',
  messagingSenderId: '39123611577',
  appId: '1:39123611577:web:ac7d974ef3efcddda05068',
  measurementId: 'G-DCK2W6947S'
};

// Firestore document path used as the app-wide state store.
// Gunakan Firebase Console -> Firestore -> Documents untuk melihat dokumen ini.
const FIREBASE_STATE_PATH = 'appState/web-joki';
let firebaseEnabled = false;
// Local QRIS server (Express) URL — change if hosted elsewhere
const QRIS_SERVER_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : `${window.location.origin.replace(window.location.pathname, '')}:3000`;

const defaultData = {
  users: [],
  admins: [],
  owners: [],
  deletedOrders: [],

  services: [
    {
      id: 'carry-rank',
      title: 'Carry Rank & Progress',
      category: 'Progress',
      price: 'Rp 50.000 - 180.000',
      duration: '2-6 jam',
      joki: '',
      description: 'Mendapatkan progres akun, naik rank, dan menyelesaikan objective tanpa kehilangan momentum.',
      requirements: ['User ID target', 'Password akun', 'Min. rank 30'],
      tag: 'Paling laris',
      status: 'Tersedia'
    },
    {
      id: 'boss-farm',
      title: 'Boss Farm & Material Run',
      category: 'Farm',
      price: 'Rp 35.000 - 120.000',
      duration: '1-3 jam',
        joki: '',
      description: 'Layanan farming harian, material premium, dan clear challenge dengan tingkat keberhasilan tinggi.',
      requirements: ['Akun aktif', 'Target material', 'Stamina cukup'],
      tag: 'Rekomendasi',
      status: 'Tersedia'
    },
    {
      id: 'character-build',
      title: 'Character Build & Team Setup',
      category: 'Build',
      price: 'Rp 70.000 - 220.000',
      duration: '4-8 jam',
      joki: '',
      description: 'Optimasi rosters, rekomendasi build, dan setup rotasi untuk menghadapi konten sulit.',
      requirements: ['Akun target', 'Preferensi build', 'Budget setup'],
      tag: 'Premium',
      status: 'Tersedia'
    },
    {
      id: 'event-clear',
      title: 'Event Clear & Event Trial',
      category: 'Event',
      price: 'Rp 45.000 - 160.000',
      duration: '2-5 jam',
      joki: '',
      description: 'Bantuan menyelesaikan event khusus, trial, dan reward harian secara efisien.',
      requirements: ['User ID', 'Target event', 'Akun siap'],
      tag: 'Event',
      status: 'Tersedia'
    },
    {
      id: 'account-boost',
      title: 'Account Boost & Resource Recovery',
      category: 'Recovery',
      price: 'Rp 60.000 - 200.000',
      duration: '3-7 jam',
      joki: '',
      description: 'Layanan pemulihan akun, boost resource, dan peningkatan daya saing akun.',
      requirements: ['Akun target', 'Recovery plan', 'Password aman'],
      tag: 'Recovery',
      status: 'Tersedia'
    },
    {
      id: 'daily-run',
      title: 'Daily Run & Routine Loop',
      category: 'Routine',
      price: 'Rp 25.000 - 90.000',
      duration: '1-2 jam',
      joki: '',
      description: 'Sesi rutin harian untuk menyelesaikan loop dengan cepat dan konsisten.',
      requirements: ['Akun aktif', 'Target loop', 'Penjadwalan'],
      tag: 'Daily',
      status: 'Tersedia'
    }
  ],
  orders: [],
  chats: [],
  jokiDirectory: []
};

const state = {
  selectedServiceId: null,
  pendingOrderId: null,
  currentPage: 1,
  itemsPerPage: 6,
  currentUser: loadSession(),
  view: 'home-view'
};

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('nve-joki-demo') : null;

async function initializeFirebase() {
  if (!FIREBASE_CONFIG.apiKey) {
    return false;
  }

  if (!window.firebase?.firestore) {
    console.warn('Firebase SDK belum dimuat. Pastikan skrip Firebase ada di index.html.');
    return false;
  }

  if (!firebase.apps.length) {
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
    } catch (error) {
      console.warn('Firebase initialization failed:', error);
      return false;
    }
  }

  firebaseEnabled = true;
  return true;
}

function loadLocalData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...defaultData, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to parse saved data', error);
  }
  return defaultData;
}

async function loadData() {
  const localData = loadLocalData();
  if (!FIREBASE_CONFIG.apiKey) {
    return localData;
  }

  const initialized = await initializeFirebase();
  if (!initialized) {
    return localData;
  }

  try {
    // Load app-wide state (orders/users/etc)
    const docRef = firebase.firestore().doc(FIREBASE_STATE_PATH);
    const snapshot = await docRef.get();

    let stateData = snapshot.exists ? snapshot.data() : null;

    // Load services from collection `services` (each doc is one service)
    const servicesSnap = await firebase.firestore().collection('services').get();
    const services = servicesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Merge: stateData (if exists) + defaultData; then override services with Firestore collection
    const merged = { ...defaultData, ...(stateData || {}), services };

    // If dokumen belum ada, buat dokumen awal di Firestore (tanpa services field karena services berasal dari collection)
    if (!snapshot.exists) {
      const toSeed = { ...localData, services: [] };
      await docRef.set(toSeed);
      return { ...defaultData, ...(toSeed || {}), services };
    }

    return merged;
  } catch (error) {
    console.warn('Failed to load Firebase data:', error);
  }

  return localData;
}

async function syncFirebaseState() {
  if (!firebaseEnabled) return;

  try {
    await firebase.firestore().doc(FIREBASE_STATE_PATH).set(db);
  } catch (error) {
    console.warn('Failed to sync state to Firebase:', error);
  }
}

function subscribeFirebaseState() {
  if (!firebaseEnabled) return;

  const docRef = firebase.firestore().doc(FIREBASE_STATE_PATH);
  docRef.onSnapshot((snapshot) => {
    if (!snapshot.exists) return;
    const remoteState = snapshot.data();
    const localJson = JSON.stringify(db);
    const remoteJson = JSON.stringify({ ...defaultData, ...remoteState });
    if (localJson !== remoteJson) {
      db = { ...defaultData, ...remoteState };
      persistLocalState();
      renderAll();
    }
  }, (error) => {
    console.warn('Firebase realtime listener error:', error);
  });
}

function persistLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

let db = defaultData;

function loadSession() {
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.warn('Failed to parse saved auth session', error);
    return null;
  }
}

function persistSession() {
  if (state.currentUser) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(state.currentUser));
    channel?.postMessage({ type: 'auth-sync', payload: state.currentUser });
  } else {
    localStorage.removeItem(AUTH_KEY);
    channel?.postMessage({ type: 'auth-sync', payload: null });
  }
}

function persistData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  channel?.postMessage({ type: 'sync', payload: db });
  if (firebaseEnabled) {
    syncFirebaseState();
  }
}

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && event.newValue) {
    const incoming = JSON.parse(event.newValue);
    Object.assign(db, incoming);
    renderAll();
  }

  if (event.key === AUTH_KEY) {
    state.currentUser = event.newValue ? JSON.parse(event.newValue) : null;
    renderAll();
  }
});

channel?.addEventListener('message', (event) => {
  if (event.data?.type === 'sync' && event.data.payload) {
    Object.assign(db, event.data.payload);
    renderAll();
  }

  if (event.data?.type === 'auth-sync') {
    state.currentUser = event.data.payload;
    renderAll();
  }
});

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

function getAdminMetrics(adminUsername) {
  const acceptedOrders = db.orders.filter((order) => order.acceptedBy === adminUsername);
  const totalValue = acceptedOrders.reduce((sum, order) => sum + Number(order.budget || 0), 0);
  return {
    acceptedOrders,
    totalValue,
    commission: totalValue * 0.9
  };
}

function getServiceBasePrice(service) {
  if (!service?.price) return 0;
  const match = service.price.match(/[\d.]+/);
  if (!match) return 0;
  const cleaned = String(match[0]).replace(/\./g, '').replace(/,/g, '');
  return Number(cleaned || 0);
}

const STATUS_STYLES = {
  'Menunggu Penugasan': 'pending',
  'Diterima': 'progress',
  'Proses Pengerjaan': 'progress',
  'Menunggu Konfirmasi Owner': 'pending',
  'Berhasil': 'success',
  'Gagal': 'failed'
};

const PAYMENT_STYLES = {
  'Dibayar': 'payment-paid',
  'Belum Dibayar': 'payment-pending'
};

function getStatusClass(status) {
  return STATUS_STYLES[status] || 'pending';
}

function getPaymentClass(paymentStatus) {
  return PAYMENT_STYLES[paymentStatus] || 'payment-pending';
}

function getCurrentUser() {
  if (!state.currentUser) return null;
  if (state.currentUser.role === 'owner') {
    const owner = db.owners.find((entry) => entry.username === state.currentUser.username);
    if (owner) {
      return { ...owner, role: 'owner' };
    }
    return { ...state.currentUser, role: 'owner' };
  }
  if (state.currentUser.role === 'admin') {
    const admin = db.admins.find((entry) => entry.username === state.currentUser.username);
    if (admin) {
      return { ...admin, role: 'admin' };
    }
    return { ...state.currentUser, role: 'admin' };
  }

  const user = db.users.find((entry) => entry.username === state.currentUser.username);
  if (user) {
    return { ...user, role: 'user' };
  }
  return { ...state.currentUser, role: 'user' };
}

function switchAccountRole(accountKey, targetRole) {
  const [currentRole, accountId] = accountKey.split(':');
  if (!currentRole || !accountId) {
    alert('Pilih akun terlebih dahulu.');
    return;
  }

  if (currentRole === targetRole) {
    const currentLabel = currentRole === 'admin' ? 'admin' : 'user';
    alert(`Akun sudah berstatus ${currentLabel}.`);
    return;
  }

  let selectedAccount;
  if (currentRole === 'user') {
    selectedAccount = db.users.find((entry) => entry.id === accountId);
    if (!selectedAccount) {
      alert('Akun user tidak ditemukan.');
      return;
    }
    db.users = db.users.filter((entry) => entry.id !== accountId);
  } else {
    selectedAccount = db.admins.find((entry) => entry.id === accountId);
    if (!selectedAccount) {
      alert('Akun admin tidak ditemukan.');
      return;
    }
    db.admins = db.admins.filter((entry) => entry.id !== accountId);
  }

  if (targetRole === 'admin') {
    db.admins.push({ ...selectedAccount, role: 'admin' });
    alert(`Akun ${selectedAccount.username} berhasil dijadikan admin.`);
  } else {
    db.users.push({ ...selectedAccount, role: 'user' });
    alert(`Akun ${selectedAccount.username} berhasil dijadikan user.`);
  }

  persistData();
  renderAll();
}

function demoteAdmin(adminId) {
  const admin = db.admins.find((a) => a.id === adminId);
  if (!admin) return alert('Admin tidak ditemukan.');

  // Move admin back to users list
  db.admins = db.admins.filter((a) => a.id !== adminId);
  // ensure unique user id
  const newUserId = `user-${Date.now()}`;
  db.users.push({ id: newUserId, username: admin.username, password: admin.password, name: admin.name, role: 'user', balance: 0, bio: '', phone: admin.phone || '', email: admin.email || '' });
  persistData();
  renderAll();
  alert(`Akun ${admin.username} berhasil dikembalikan menjadi user.`);
}

// assignServiceJoki removed because internal joki feature is disabled

function canAccess(viewName) {
  if (viewName === 'dashboard-view') return state.currentUser?.role === 'user';
  if (viewName === 'admin-view') return state.currentUser?.role === 'admin';
  if (viewName === 'owner-view' || viewName === 'owner-monitor-view' || viewName === 'owner-trash-view') return state.currentUser?.role === 'owner';
  return true;
}

function navigateTo(viewName) {
  if (!canAccess(viewName)) {
    if (viewName === 'dashboard-view') {
      alert('Halaman dashboard hanya untuk pengguna. Silakan login sebagai pengguna.');
    } else if (viewName === 'admin-view') {
      alert('Halaman admin hanya untuk administrator. Silakan login sebagai admin.');
    }
    state.view = 'auth-view';
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById('auth-view')?.classList.add('active');
    renderAll();
    return;
  }

  state.view = viewName;
  document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
  const selectedPage = document.getElementById(viewName);
  if (selectedPage) selectedPage.classList.add('active');

  if (viewName === 'detail-view') {
    document.getElementById('backToListBtn')?.focus();
  }
  renderAll();
}

function renderTopbar() {
  const topNavArea = document.getElementById('topNavArea');
  const topActions = document.getElementById('topActions');

  if (!state.currentUser) {
    topNavArea.innerHTML = '';
    topActions.innerHTML = '<button class="nav-btn primary" data-view="auth-view">Login</button>';
  } else if (state.currentUser.role === 'owner') {
    topNavArea.innerHTML = `
      <button class="nav-btn ${state.view === 'home-view' ? 'active' : ''}" data-view="home-view">Beranda</button>
      <button class="nav-btn ${state.view === 'owner-view' ? 'active' : ''}" data-view="owner-view">Owner</button>
      <button class="nav-btn ${state.view === 'owner-monitor-view' ? 'active' : ''}" data-view="owner-monitor-view">Monitoring Admin</button>
      <button class="nav-btn ${state.view === 'owner-trash-view' ? 'active' : ''}" data-view="owner-trash-view">Trash Joki</button>
    `;
    topActions.innerHTML = `
      <div class="user-pill" id="userPill">Akun: ${state.currentUser.username} (Owner)</div>
      <button class="secondary-btn" id="logoutBtn">Logout</button>
    `;
  } else if (state.currentUser.role === 'admin') {
    topNavArea.innerHTML = `
      <button class="nav-btn ${state.view === 'home-view' ? 'active' : ''}" data-view="home-view">Beranda</button>
      <button class="nav-btn ${state.view === 'admin-view' ? 'active' : ''}" data-view="admin-view">Admin</button>
      <button class="nav-btn ${state.view === 'admin-orders-view' ? 'active' : ''}" data-view="admin-orders-view">Orderan</button>
    `;
    topActions.innerHTML = `
      <div class="user-pill" id="userPill">Akun: ${state.currentUser.username} (Admin)</div>
      <button class="secondary-btn" id="logoutBtn">Logout</button>
    `;
  } else {
    topNavArea.innerHTML = `
      <button class="nav-btn ${state.view === 'home-view' ? 'active' : ''}" data-view="home-view">Beranda</button>
      <button class="nav-btn ${state.view === 'dashboard-view' ? 'active' : ''}" data-view="dashboard-view">Dashboard</button>
    `;
    topActions.innerHTML = `
      <div class="user-pill" id="userPill">Akun: ${state.currentUser.username} (User)</div>
      <button class="secondary-btn" id="logoutBtn">Logout</button>
    `;
  }

  topNavArea.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(button.dataset.view));
  });

  const loginButton = topActions.querySelector('[data-view="auth-view"]');
  loginButton?.addEventListener('click', () => navigateTo('auth-view'));

  const logoutButton = document.getElementById('logoutBtn');
  logoutButton?.addEventListener('click', () => {
    state.currentUser = null;
    persistSession();
    navigateTo('home-view');
  });
}

function renderServiceGrid() {
  const grid = document.getElementById('serviceGrid');
  const search = document.getElementById('searchInput').value.toLowerCase();

  const services = Array.isArray(db.services) ? db.services : [];

  const filtered = services.filter((service) =>
    [service.title, service.category, service.joki, service.description].some((field) => String(field || '').toLowerCase().includes(search))
  );

  if (!services.length) {
    grid.innerHTML = '<p class="body-copy">Tidak ada layanan tersedia.</p>';
    document.getElementById('pageInfo').textContent = `Halaman 1 / 1`;
    document.getElementById('prevPageBtn').disabled = true;
    document.getElementById('nextPageBtn').disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.itemsPerPage));
  if (state.currentPage > totalPages) state.currentPage = totalPages;

  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const pageItems = filtered.slice(startIndex, startIndex + state.itemsPerPage);

  document.getElementById('pageInfo').textContent = `Halaman ${state.currentPage} / ${totalPages}`;
  document.getElementById('prevPageBtn').disabled = state.currentPage === 1;
  document.getElementById('nextPageBtn').disabled = state.currentPage === totalPages;

  grid.innerHTML = pageItems.map((service) => `
    <article class="service-card" data-service-id="${service.id}">
      <div class="service-title-row">
        <div>
          <div class="card-meta">
            <span class="pill pill-primary">${service.category}</span>
            <span class="pill pill-neutral">${service.status}</span>
          </div>
          <h3>${service.title}</h3>
        </div>
        <span class="pill pill-warning">${service.tag}</span>
      </div>
      <p>${service.description}</p>
      <div class="card-meta">
        <span class="pill pill-success">Joki: ${service.joki}</span>
      </div>
      <div class="card-footer">
        <div>
          <div class="card-price">${service.price}</div>
          <p class="item-subtle">Durasi ${service.duration}</p>
        </div>
        <button class="small-btn">Lihat detail</button>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.service-card').forEach((card) => {
    card.addEventListener('click', () => {
      const serviceId = card.dataset.serviceId;
      state.selectedServiceId = serviceId;
      renderDetail();
      navigateTo('detail-view');
    });
  });
}

function renderDetail() {
  const service = db.services.find((item) => item.id === state.selectedServiceId);
  if (!service) return;

  document.getElementById('detailCategory').textContent = service.category;
  document.getElementById('detailTag').textContent = service.status;
  document.getElementById('detailTitle').textContent = service.title;
  document.getElementById('detailDescription').textContent = service.description;
  document.getElementById('detailPrice').textContent = service.price;
  document.getElementById('detailDuration').textContent = service.duration;
  document.getElementById('detailJoki').textContent = service.joki || 'Belum ditugaskan';
  document.getElementById('detailRequirements').innerHTML = service.requirements.map((item) => `<li>${item}</li>`).join('');
  document.getElementById('orderBudget').value = getServiceBasePrice(service);
  document.getElementById('orderBudget').disabled = true;

  const chatBox = document.getElementById('customerChatBox');
  chatBox.innerHTML = db.chats.map((entry) => `<div class="chat-bubble ${entry.sender}">${entry.sender === 'support' ? 'Support' : 'You'}: ${entry.message}</div>`).join('');
  chatBox.scrollTop = chatBox.scrollHeight;

  document.getElementById('paymentStatus').textContent = 'Belum bayar';
  document.getElementById('paymentStatus').style.color = 'var(--warning)';
}

function renderDashboard() {
  const user = getCurrentUser();

  const profileSummary = document.getElementById('profileSummary');
  if (!user || user.role !== 'user') {
    profileSummary.innerHTML = '<p class="body-copy">Akses dashboard hanya untuk pengguna. Silakan login dengan akun pengguna.</p>';
    document.getElementById('userBalance').textContent = '0';
    document.getElementById('userOrdersList').innerHTML = '<p class="body-copy">Belum ada pesanan.</p>';
    return;
  }

  const persistedUser = db.users.find((entry) => entry.id === user.id) || user;
  const balance = Number(persistedUser.balance || 0);

  profileSummary.innerHTML = `
    <p class="section-title">${persistedUser.name}</p>
    <p class="body-copy">@${persistedUser.username} • ${persistedUser.email || 'email belum diisi'} • ${persistedUser.phone}</p>
    <p class="body-copy">${persistedUser.bio}</p>
    <div class="detail-meta">
      <div class="meta-box"><p class="meta-label">Saldo</p><p class="meta-value">${formatCurrency(balance)}</p></div>
      <div class="meta-box"><p class="meta-label">Role</p><p class="meta-value">${persistedUser.role.toUpperCase()}</p></div>
      <div class="meta-box"><p class="meta-label">Status</p><p class="meta-value">Aktif</p></div>
    </div>
  `;
  document.getElementById('userBalance').textContent = formatCurrency(balance);
  document.getElementById('balanceMessage').textContent = 'Pembayaran dilakukan lewat QRIS custom. Klik Bayar via QRIS untuk memproses pembayaran.';

  const userOrders = db.orders.filter((order) => order.userId === persistedUser.id);
  if (!userOrders.length) {
    document.getElementById('userOrdersList').innerHTML = '<p class="body-copy">Belum ada pesanan.</p>';
  } else {
    document.getElementById('userOrdersList').innerHTML = userOrders.map((order) => {
      const service = db.services.find((item) => item.id === order.serviceId);
      const payButton = order.paymentStatus === 'Belum Dibayar'
        ? `<button class="small-btn pay-order-btn" data-order-id="${order.id}">Bayar via QRIS</button>`
        : '';
      return `
        <article class="order-item">
          <div class="order-head">
            <strong>#${order.id} • ${service?.title || 'Layanan'}</strong>
            <div class="order-badges">
              <span class="status-badge ${getStatusClass(order.status)}">${order.status}</span>
              <span class="status-badge ${getPaymentClass(order.paymentStatus)}">${order.paymentStatus}</span>
            </div>
          </div>
          <div class="order-body">
            <span class="item-subtle">Joki: ${order.assignedJoki}</span>
            <span class="item-subtle">Penugasan: ${order.acceptedByName ? order.acceptedByName : 'Menunggu admin mengambil order'}</span>
            <span class="item-subtle">Budget: ${formatCurrency(order.budget)}</span>
            <span class="item-subtle">Tanggal: ${order.createdAt}</span>
          </div>
          <div class="order-actions">${payButton}</div>
        </article>
      `;
    }).join('');
  }

  document.querySelectorAll('.pay-order-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.orderId;
      const order = db.orders.find((entry) => entry.id === orderId);
      if (!order || order.userId !== persistedUser.id) {
        alert('Pesanan tidak ditemukan atau bukan milik akun Anda.');
        return;
      }
      if (order.paymentStatus === 'Dibayar') {
        alert('Pesanan ini sudah dibayar.');
        return;
      }

      renderQrisPayment(order);
    });
  });
}

function renderQrisPayment(order) {
  const amount = Number(order.budget || 0);
  // Try server-based QR generation first
  fetch(`${QRIS_SERVER_URL}/create-qris`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: order.id, amount, description: `Pembayaran order ${order.id}` })
  }).then((res) => res.json()).then((data) => {
    if (data && data.payUrl) {
      // open server QR page which shows QR image
      const full = `${QRIS_SERVER_URL}${data.payUrl}`.replace(/([^:]\/)\//g, '$1/');
      window.open(full, '_blank');
      alert('Halaman QRIS dibuka. Silakan lakukan pembayaran lalu tunggu sistem mendeteksi konfirmasi otomatis.');
    } else if (data && data.qrcode) {
      // fallback: show data URL
      const w = window.open('about:blank');
      if (w) {
        w.document.write(`<img src="${data.qrcode}" alt="QRIS"/><p>Scan untuk bayar ${formatCurrency(amount)}</p>`);
      }
      alert('QRIS ditampilkan dalam jendela baru. Silakan bayar dan tunggu konfirmasi otomatis.');
    } else {
      throw new Error('Invalid QR response');
    }
  }).catch((err) => {
    console.warn('QRIS server unreachable, falling back to manual confirm', err);
    const qrisContent = `QRIS Payment\nNominal: Rp ${formatCurrency(amount)}\nTujuan: E-wallet / bank Anda\n\nGunakan aplikasi e-wallet atau mobile banking untuk memindai QRIS ini dan bayar sebesar nominal di atas.`;
    const qrisLink = `https://example.com/qris-pay?amount=${amount}`;
    const proceed = confirm(`${qrisContent}\n\nKlik OK untuk membuka tautan pembayaran QRIS (fallback) dan konfirmasi setelah transfer selesai.`);
    if (!proceed) return;
    window.open(qrisLink, '_blank');
    const confirmed = confirm('Apakah pembayaran QRIS sudah selesai? Jika sudah, klik OK untuk menyelesaikan proses.');
    if (confirmed) {
      order.paymentStatus = 'Dibayar';
      order.paymentMethod = 'QRIS';
      order.paidAt = new Date().toISOString();
      persistData();
      renderAll();
      alert(`Pembayaran order ${order.id} terkonfirmasi. Status: Dibayar.`);
    } else {
      alert('Pembayaran belum dikonfirmasi. Order masih menunggu pembayaran.');
    }
  });
}

function renderAdmin() {
  const admin = getCurrentUser();
  const adminDashboardMetricsEl = document.getElementById('adminDashboardMetrics');
  const jokiDirectoryEl = document.getElementById('jokiDirectory');
  const adminOrdersListEl = document.getElementById('adminOrdersList');
  const orderSelectEl = document.getElementById('orderSelect');

  if (!admin || admin.role !== 'admin') {
    adminDashboardMetricsEl.innerHTML = '';
    if (jokiDirectoryEl) {
      jokiDirectoryEl.innerHTML = '<p class="body-copy">Akses admin hanya untuk administrator. Silakan login sebagai admin.</p>';
    }
    adminOrdersListEl.innerHTML = '<p class="body-copy">Tidak ada data pesanan untuk ditampilkan.</p>';
    orderSelectEl.innerHTML = '<option value="">Tidak ada pesanan</option>';
    return;
  }

  const metrics = getAdminMetrics(admin.username);
  adminDashboardMetricsEl.innerHTML = `
    <div class="meta-box"><p class="meta-label">Total nilai joki</p><p class="meta-value">${formatCurrency(metrics.totalValue)}</p></div>
    <div class="meta-box"><p class="meta-label">Komisi 90%</p><p class="meta-value">${formatCurrency(metrics.commission)}</p></div>
    <div class="meta-box"><p class="meta-label">Jumlah order aktif</p><p class="meta-value">${metrics.acceptedOrders.length}</p></div>
  `;

  if (jokiDirectoryEl) {
    jokiDirectoryEl.innerHTML = db.jokiDirectory.length
      ? db.jokiDirectory.map((joki) => `
          <div class="joki-item">
            <div class="service-title-row">
              <div>
                <strong>${joki.name} • ${joki.role}</strong>
                <div class="item-subtle">Rating ${joki.rating} • ${joki.completed} pekerjaan selesai</div>
              </div>
              <span class="pill pill-success">${joki.status}</span>
            </div>
            <p class="body-copy">${joki.bio}</p>
            <div class="card-meta">
              ${joki.jobs.map((job) => `<span class="pill pill-neutral">${job.title}: ${job.status}</span>`).join('')}
            </div>
          </div>
        `).join('')
      : '<p class="body-copy">Tidak ada data joki internal.</p>';
  }

  adminOrdersListEl.innerHTML = db.orders.map((order) => {
    const service = db.services.find((item) => item.id === order.serviceId);
    return `
      <article class="order-item">
        <div class="order-head">
          <strong>#${order.id} • ${service?.title || 'Layanan'}</strong>
          <div class="order-badges">
            <span class="status-badge ${getStatusClass(order.status)}">${order.status}</span>
            <span class="status-badge ${getPaymentClass(order.paymentStatus)}">${order.paymentStatus}</span>
          </div>
        </div>
        <div class="order-body">
          <span class="item-subtle">Pengguna: ${order.userIdTarget} • Joki: ${order.assignedJoki}</span>
          <span class="item-subtle">Penugasan: ${order.acceptedByName ? order.acceptedByName : 'Belum diambil'}</span>
          <span class="item-subtle">Budget: ${formatCurrency(order.budget)} • ${order.createdAt}</span>
        </div>
      </article>
    `;
  }).join('');

  const orderSelect = document.getElementById('orderSelect');
  orderSelect.innerHTML = db.orders.map((order) => `<option value="${order.id}">${order.id} - ${db.services.find((item) => item.id === order.serviceId)?.title || 'Layanan'}</option>`).join('');
}

function renderOwner() {
  const owner = getCurrentUser();
  if (!owner || owner.role !== 'owner') {
    const ownerOverviewStatsEl = document.getElementById('ownerOverviewStats');
    const ownerAdminListEl = document.getElementById('ownerAdminList');
    const ownerJokiListEl = document.getElementById('ownerJokiList');

    if (ownerOverviewStatsEl) ownerOverviewStatsEl.innerHTML = '';
    if (ownerAdminListEl) ownerAdminListEl.innerHTML = '<p class="body-copy">Akses owner hanya untuk pemilik sistem.</p>';
    if (ownerJokiListEl) ownerJokiListEl.innerHTML = '<p class="body-copy">Tidak ada data joki.</p>';
    return;
  }

  const totalAdmins = db.admins.length;
  const totalJoki = db.jokiDirectory.length;
  const totalServices = db.services.length;
  const totalOrders = db.orders.length;

  document.getElementById('ownerOverviewStats').innerHTML = `
    <div class="meta-box"><p class="meta-label">Total admin</p><p class="meta-value">${totalAdmins}</p></div>
    <div class="meta-box"><p class="meta-label">Total joki</p><p class="meta-value">${totalJoki}</p></div>
    <div class="meta-box"><p class="meta-label">Total layanan</p><p class="meta-value">${totalServices}</p></div>
    <div class="meta-box"><p class="meta-label">Total order</p><p class="meta-value">${totalOrders}</p></div>
  `;

  const ownerAccountSelect = document.getElementById('ownerAccountSelect');
  if (ownerAccountSelect) {
    const accountOptions = [
      ...db.users.map((user) => ({
        key: `user:${user.id}`,
        label: `${user.username} — ${user.name} (User)`
      })),
      ...db.admins.map((admin) => ({
        key: `admin:${admin.id}`,
        label: `${admin.username} — ${admin.name} (Admin)`
      }))
    ];

    ownerAccountSelect.innerHTML = accountOptions.length
      ? accountOptions.map((entry) => `<option value="${entry.key}">${entry.label}</option>`).join('')
      : '<option value="">Tidak ada akun</option>';
  }

  // internal joki selection removed; no options

  document.getElementById('ownerAdminList').innerHTML = db.admins.map((admin) => {
    const metrics = getAdminMetrics(admin.username);
    return `
      <article class="order-item">
        <div class="order-head">
          <strong>${admin.name} • ${admin.username}</strong>
          <div class="order-badges">
            <span class="status-badge success">Admin aktif</span>
          </div>
        </div>
        <div class="order-body">
          <span class="item-subtle">Order diambil: ${metrics.acceptedOrders.length}</span>
          <span class="item-subtle">Total nilai joki: ${formatCurrency(metrics.totalValue)}</span>
          <span class="item-subtle">Komisi 90%: ${formatCurrency(metrics.commission)}</span>
          <div class="order-actions">
            <button class="small-btn" onclick="demoteAdmin('${admin.id}')">Jadikan user</button>
          </div>
        </div>
      </article>
    `;
  }).join('') || '<p class="body-copy">Belum ada admin.</p>';

  document.getElementById('ownerServiceList').innerHTML = db.services.map((service) => `
    <article class="order-item">
      <div class="order-head">
        <strong>${service.title}</strong>
        <div class="order-badges">
          <span class="status-badge success">${service.category}</span>
          <span class="status-badge ${service.status === 'Tersedia' ? 'success' : 'failed'}">${service.status}</span>
        </div>
      </div>
      <div class="order-body">
        <span class="item-subtle">Joki: ${service.joki || 'Belum ditugaskan'}</span>
        <span class="item-subtle">Harga: ${service.price}</span>
        <span class="item-subtle">Durasi: ${service.duration}</span>
        <span class="item-subtle">Tag: ${service.tag}</span>
      </div>
      
      <p class="body-copy">${service.description}</p>
    </article>
  `).join('') || '<p class="body-copy">Belum ada layanan.</p>';

  const ownerJokiListEl = document.getElementById('ownerJokiList');
  if (ownerJokiListEl) {
    ownerJokiListEl.innerHTML = '<p class="body-copy">Fitur joki internal telah dihapus.</p>';
  }
}

function cleanupDeletedOrdersAuto() {
  db.deletedOrders = db.deletedOrders || [];
  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000; // 24 hours
  const beforeCount = db.deletedOrders.length;
  db.deletedOrders = db.deletedOrders.filter((o) => {
    const age = now - Date.parse(o.deletedAt || 0);
    return age < TTL;
  });
  if (db.deletedOrders.length !== beforeCount) {
    persistData();
  }
}

function renderOwnerMonitoring() {
  cleanupDeletedOrdersAuto();
  const owner = getCurrentUser();
  if (!owner || owner.role !== 'owner') {
    document.getElementById('ownerMonitorList').innerHTML = '<p class="body-copy">Akses monitoring hanya untuk owner.</p>';
    return;
  }

  document.getElementById('ownerMonitorList').innerHTML = db.admins.map((admin) => {
    const metrics = getAdminMetrics(admin.username);
    const ordersHtml = metrics.acceptedOrders.length
      ? metrics.acceptedOrders.map((o) => {
          const service = db.services.find((s) => s.id === o.serviceId) || {};
          const acceptedAtText = o.acceptedAt ? new Date(o.acceptedAt).toLocaleString('id-ID') : 'Waktu belum tercatat';
          return `
            <article class="order-item small">
              <div class="order-head">
                <strong>#${o.id} • ${service.title || 'Layanan'}</strong>
                <div class="order-badges">
                  <span class="status-badge ${getStatusClass(o.status)}">${o.status}</span>
                </div>
              </div>
              <div class="order-body">
                <span class="item-subtle">Pengguna: ${o.userIdTarget}</span>
                <span class="item-subtle">Budget: ${formatCurrency(o.budget)} • ${o.createdAt}</span>
                <span class="item-subtle">Diterima: ${acceptedAtText}</span>
                <span class="item-subtle">Assigned Joki: ${o.assignedJoki || '—'}</span>
              </div>
              <div class="order-actions">
                <button class="small-btn danger" onclick="ownerDeleteOrder('${o.id}')">Hapus order</button>
              </div>
            </article>
          `;
        }).join('')
      : '<p class="body-copy">Belum ada order diterima oleh admin ini.</p>';

    return `
      <article class="order-item">
        <div class="order-head">
          <strong>${admin.name} • ${admin.username}</strong>
          <div class="order-badges">
            <span class="status-badge success">${metrics.acceptedOrders.length} order</span>
          </div>
        </div>
        <div class="order-body">
          <span class="item-subtle">Total nilai: ${formatCurrency(metrics.totalValue)}</span>
          <span class="item-subtle">Komisi 90%: ${formatCurrency(metrics.commission)}</span>
          <span class="item-subtle">Status kerja: ${metrics.acceptedOrders.length > 0 ? 'Aktif' : 'Belum mengambil kerja'}</span>
        </div>
        <div class="order-actions">
          <button class="small-btn" onclick="(function(){const el=document.getElementById('admin-detail-${admin.id}'); if(el) el.style.display = el.style.display === 'none' ? 'block' : 'none';})()">Lihat detail</button>
        </div>
        <div id="admin-detail-${admin.id}" style="display:none; margin-top:8px;">
          ${ordersHtml}
        </div>
      </article>
    `;
  }).join('') || '<p class="body-copy">Belum ada admin untuk dipantau.</p>';

  const pendingRequests = db.orders.filter((o) => o.status === 'Menunggu Konfirmasi Owner');
  const pendingHtml = pendingRequests.length
    ? pendingRequests.map((o) => {
        const service = db.services.find((s) => s.id === o.serviceId) || {};
        return `
          <article class="order-item small">
            <div class="order-head">
              <strong>#${o.id} • ${service.title || 'Layanan'}</strong>
              <div class="order-badges">
                <span class="status-badge pending">${o.status}</span>
              </div>
            </div>
            <div class="order-body">
              <span class="item-subtle">Pengguna: ${o.userIdTarget}</span>
              <span class="item-subtle">Permintaan selesai oleh: ${o.completionRequest?.requestedByName || o.completionRequest?.requestedBy || 'Admin'}</span>
              <span class="item-subtle">Tanggal selesai: ${o.completionRequest?.completionDate || '-'}</span>
              <span class="item-subtle">Bukti: ${o.completionRequest?.proof || 'Tidak ada bukti'}</span>
            </div>
            <div class="order-actions">
              <button class="small-btn" onclick="ownerConfirmOrderCompletion('${o.id}')">Konfirmasi selesai</button>
              <button class="small-btn danger" onclick="ownerRejectOrderCompletion('${o.id}')">Tolak</button>
            </div>
          </article>
        `;
      }).join('')
    : '<p class="body-copy">Tidak ada permintaan selesai menunggu konfirmasi.</p>';

  document.getElementById('ownerMonitorList').innerHTML += `
    <div style="margin-top:24px;">
      <h4>Permintaan penyelesaian</h4>
      ${pendingHtml}
    </div>
  `;
}

function renderOwnerTrashPage() {
  const owner = getCurrentUser();
  if (!owner || owner.role !== 'owner') {
    document.getElementById('ownerTrashList').innerHTML = '<p class="body-copy">Akses trash hanya untuk owner.</p>';
    return;
  }

  const trashOrders = (db.deletedOrders || []).slice().sort((a, b) => {
    const orderPriority = ['Menunggu Penugasan', 'Diterima', 'Proses Pengerjaan', 'Menunggu Konfirmasi Owner', 'Berhasil', 'Gagal'];
    const indexA = orderPriority.indexOf(a.status);
    const indexB = orderPriority.indexOf(b.status);
    if (indexA !== indexB) return indexA - indexB;
    return new Date(b.deletedAt) - new Date(a.deletedAt);
  });

  document.getElementById('ownerTrashList').innerHTML = trashOrders.length
    ? trashOrders.map((o) => {
        const service = db.services.find((s) => s.id === o.serviceId) || {};
        return `
          <article class="order-item">
            <div class="order-head">
              <strong>#${o.id} • ${service.title || 'Layanan'}</strong>
              <div class="order-badges">
                <span class="status-badge ${getStatusClass(o.status)}">${o.status}</span>
                <span class="status-badge pending">Trash</span>
              </div>
            </div>
            <div class="order-body">
              <span class="item-subtle">Pengguna: ${o.userIdTarget}</span>
              <span class="item-subtle">Budget: ${formatCurrency(o.budget)} • ${o.createdAt}</span>
              <span class="item-subtle">Dihapus pada: ${o.deletedAt}</span>
            </div>
            <div class="order-actions">
              <button class="small-btn" onclick="ownerRestoreOrder('${o.id}')">Undo</button>
              <button class="small-btn danger" onclick="ownerPermanentlyDeleteOrder('${o.id}')">Hapus permanen</button>
            </div>
          </article>
        `;
      }).join('')
    : '<p class="body-copy">Tidak ada order di trash.</p>';
}

function ownerConfirmOrderCompletion(orderId) {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return alert('Order tidak ditemukan.');
  if (order.status !== 'Menunggu Konfirmasi Owner') return alert('Order tidak dalam status permintaan konfirmasi.');
  order.status = 'Berhasil';
  order.completedAt = new Date().toISOString();
  persistData();
  renderAll();
  alert(`Order ${orderId} telah dikonfirmasi selesai oleh owner.`);
}

function ownerRejectOrderCompletion(orderId) {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return alert('Order tidak ditemukan.');
  if (order.status !== 'Menunggu Konfirmasi Owner') return alert('Order tidak dalam status permintaan konfirmasi.');
  order.status = 'Gagal';
  persistData();
  renderAll();
  alert(`Order ${orderId} ditolak dan ditandai gagal oleh owner.`);
}

function ownerDeleteOrder(orderId) {
  // Preview confirmation with summary
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return alert('Order tidak ditemukan.');
  const service = db.services.find((s) => s.id === order.serviceId) || {};
  const preview = `Anda akan memindahkan order ${orderId}\nLayanan: ${service.title || 'Layanan'}\nUser target: ${order.userIdTarget}\nBudget: ${formatCurrency(order.budget)}\n\nLanjutkan ke trash?`;
  if (!confirm(preview)) return;
  const idx = db.orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return alert('Order tidak ditemukan.');
  const [removed] = db.orders.splice(idx, 1);
  db.deletedOrders = db.deletedOrders || [];
  db.deletedOrders.push({ ...removed, deletedAt: new Date().toISOString() });
  persistData();
  renderAll();
  alert(`Order ${orderId} dipindahkan ke trash. Gunakan 'Undo' untuk mengembalikan.`);
}

function ownerRestoreOrder(orderId) {
  const idx = (db.deletedOrders || []).findIndex((o) => o.id === orderId);
  if (idx === -1) return alert('Order tidak ditemukan di trash.');
  const [order] = db.deletedOrders.splice(idx, 1);
  db.orders.push(order);
  persistData();
  renderAll();
  alert(`Order ${orderId} berhasil dikembalikan.`);
}

function ownerPermanentlyDeleteOrder(orderId) {
  if (!confirm(`Hapus permanen order ${orderId}? Aksi ini tidak dapat dibatalkan.`)) return;
  const idx = (db.deletedOrders || []).findIndex((o) => o.id === orderId);
  if (idx === -1) return alert('Order tidak ditemukan di trash.');
  db.deletedOrders.splice(idx, 1);
  persistData();
  renderAll();
  alert(`Order ${orderId} berhasil dihapus permanen.`);
}

function renderAdminOrdersPage() {
  const admin = getCurrentUser();
  if (!admin || admin.role !== 'admin') {
    document.getElementById('adminQueueList').innerHTML = '<p class="body-copy">Akses antrean orderan hanya untuk administrator.</p>';
    document.getElementById('adminAcceptedOrdersList').innerHTML = '<p class="body-copy">Tidak ada orderan yang diambil.</p>';
    return;
  }

  const acceptedOrdersByAdmin = db.orders.filter((order) => order.acceptedBy === admin.username);
  const availableOrders = db.orders.filter((order) => !order.acceptedBy);
  const canClaimMore = acceptedOrdersByAdmin.length < 2;

  const queueContent = availableOrders.length
    ? availableOrders.map((order) => {
        const service = db.services.find((item) => item.id === order.serviceId);
        const claimButton = canClaimMore
          ? `<button class="primary-btn claim-order-btn" data-order-id="${order.id}">Ambil order</button>`
          : `<button class="primary-btn" disabled>Sudah mencapai batas 2 orderan</button>`;
        return `
          <article class="order-item">
            <div class="order-head">
              <strong>#${order.id} • ${service?.title || 'Layanan'}</strong>
              <div class="order-badges">
                <span class="status-badge ${getStatusClass(order.status)}">${order.status}</span>
                <span class="status-badge ${getPaymentClass(order.paymentStatus)}">${order.paymentStatus}</span>
              </div>
            </div>
            <div class="order-body">
              <span class="item-subtle">Pengguna: ${order.userIdTarget} • Joki: ${order.assignedJoki}</span>
              <span class="item-subtle">Budget: ${formatCurrency(order.budget)} • ${order.createdAt}</span>
              <span class="item-subtle">Catatan: ${order.notes || 'Tidak ada catatan'}</span>
            </div>
            ${claimButton}
          </article>
        `;
      }).join('')
    : '<p class="body-copy">Tidak ada orderan menunggu.</p>';

  document.getElementById('adminQueueList').innerHTML = (canClaimMore ? '<p class="body-copy">Anda dapat mengambil maksimal 2 orderan.</p>' : '<p class="body-copy">Batas maksimal 2 orderan sudah tercapai.</p>') + queueContent;

  document.getElementById('adminAcceptedOrdersList').innerHTML = acceptedOrdersByAdmin.length
    ? acceptedOrdersByAdmin.map((order) => {
        const service = db.services.find((item) => item.id === order.serviceId);
        const acceptedAtText = order.acceptedAt ? new Date(order.acceptedAt).toLocaleString('id-ID') : 'Waktu belum tercatat';
        const completionRequestBlock = order.completionRequest
          ? `
              <div class="order-body">
                <span class="item-subtle">Permintaan selesai oleh: ${order.completionRequest.requestedByName || order.completionRequest.requestedBy}</span>
                <span class="item-subtle">Tanggal selesai: ${order.completionRequest.completionDate}</span>
                <span class="item-subtle">Bukti: ${order.completionRequest.proof || 'Tidak ada bukti'}</span>
                <span class="item-subtle">Status permintaan: Menunggu konfirmasi owner</span>
              </div>
            `
          : `
              <div class="status-control" style="margin-top:12px;">
                <label>
                  <span>Tanggal selesai</span>
                  <input type="date" id="completionDate-${order.id}" value="${new Date().toISOString().slice(0, 10)}" />
                </label>
                <label>
                  <span>Bukti / catatan</span>
                  <textarea id="completionProof-${order.id}" rows="2" placeholder="Contoh: screenshot, log, pesan selesai"></textarea>
                </label>
                <button class="small-btn" onclick="adminSubmitCompletionRequest('${order.id}')">Ajukan selesai ke owner</button>
              </div>
            `;
        return `
          <article class="order-item">
            <div class="order-head">
              <strong>#${order.id} • ${service?.title || 'Layanan'}</strong>
              <div class="order-badges">
                <span class="status-badge ${getStatusClass(order.status)}">${order.status}</span>
                <span class="status-badge ${getPaymentClass(order.paymentStatus)}">${order.paymentStatus}</span>
              </div>
            </div>
            <div class="order-body">
              <span class="item-subtle">Pengguna: ${order.userIdTarget} • Joki: ${order.assignedJoki}</span>
              <span class="item-subtle">Diambil oleh: ${order.acceptedByName || 'Admin tidak diketahui'}</span>
              <span class="item-subtle">Waktu penugasan: ${acceptedAtText}</span>
              <span class="item-subtle">Budget: ${formatCurrency(order.budget)} • ${order.createdAt}</span>
            </div>
            ${completionRequestBlock}
          </article>
        `;
      }).join('')
    : '<p class="body-copy">Belum ada orderan yang Anda ambil.</p>';

  document.querySelectorAll('.claim-order-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.orderId;
      const order = db.orders.find((entry) => entry.id === orderId);
      if (!order) return;
      const currentAcceptedCount = db.orders.filter((entry) => entry.acceptedBy === admin.username).length;
      if (currentAcceptedCount >= 2) {
        alert('Batas maksimal 2 orderan per admin sudah tercapai.');
        return;
      }
      order.acceptedBy = admin.username;
      order.acceptedByName = admin.name;
      order.acceptedAt = new Date().toISOString();
      order.status = 'Diterima';
      persistData();
      renderAll();
      alert(`Order ${orderId} berhasil diambil oleh ${admin.name}.`);
    });
  });
}

function adminSubmitCompletionRequest(orderId) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== 'admin') {
    return alert('Akses hanya untuk admin.');
  }
  const order = db.orders.find((entry) => entry.id === orderId);
  if (!order) {
    return alert('Order tidak ditemukan.');
  }
  const completionDateInput = document.getElementById(`completionDate-${orderId}`);
  const proofInput = document.getElementById(`completionProof-${orderId}`);
  const completionDate = completionDateInput?.value;
  const proof = proofInput?.value.trim();
  if (!completionDate) {
    return alert('Tanggal penyelesaian harus diisi.');
  }
  if (!proof) {
    return alert('Bukti atau catatan penyelesaian harus diisi.');
  }
  order.completionRequest = {
    requestedBy: admin.username,
    requestedByName: admin.name,
    requestedAt: new Date().toISOString(),
    completionDate,
    proof
  };
  order.status = 'Menunggu Konfirmasi Owner';
  persistData();
  renderAll();
  alert('Permintaan selesai telah dikirim ke owner.');
}

function renderAll() {
  renderTopbar();
  renderServiceGrid();
  renderDashboard();
  renderAdmin();
  renderAdminOrdersPage();
  renderOwner();
  renderOwnerMonitoring();
  renderOwnerTrashPage();
}

function handleLogin(username, password) {
  // Demo-safe: tetap gunakan username/password dari Firestore dokumen state.
  // Jika kamu mau semua role masuk ke Firebase Auth, ini perlu migrasi ke Firebase Auth + Custom Claims.

  const owner = db.owners.find((entry) => entry.username === username && entry.password === password);
  if (owner) {
    state.currentUser = { username: owner.username, role: 'owner', name: owner.name };
    persistSession();
    navigateTo('owner-view');
    alert(`Login owner berhasil sebagai ${owner.name}.`);
    return true;
  }

  const admin = db.admins.find((entry) => entry.username === username && entry.password === password);
  if (admin) {
    state.currentUser = { username: admin.username, role: 'admin', name: admin.name };
    persistSession();
    navigateTo('admin-orders-view');
    alert(`Login admin berhasil sebagai ${admin.name}.`);
    return true;
  }

  const user = db.users.find((entry) => entry.username === username && entry.password === password);
  if (user) {
    state.currentUser = { username: user.username, role: 'user', name: user.name };
    persistSession();
    navigateTo('dashboard-view');
    alert(`Login pengguna berhasil sebagai ${user.name}.`);
    return true;
  }

  alert('Login gagal. Periksa username dan password Anda.');
  return false;
}


function registerUser(username, password, name, email, phone) {
  if (db.users.some((user) => user.username === username)) {
    alert('Username sudah digunakan.');
    return;
  }
  db.users.push({
    id: `user-${Date.now()}`,
    username,
    password,
    name,
    role: 'user',
    balance: 0,
    bio: '',
    email,
    phone
  });
  persistData();
  alert('Akun berhasil dibuat. Silakan login.');
}

function attachEvents() {
  document.getElementById('searchInput').addEventListener('input', () => {
    state.currentPage = 1;
    renderServiceGrid();
  });
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    state.currentPage = Math.max(1, state.currentPage - 1);
    renderServiceGrid();
  });
  document.getElementById('nextPageBtn').addEventListener('click', () => {
    state.currentPage = Math.min(Math.ceil(db.services.length / state.itemsPerPage), state.currentPage + 1);
    renderServiceGrid();
  });
  document.getElementById('backToListBtn').addEventListener('click', () => navigateTo('home-view'));

  document.getElementById('orderForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const user = getCurrentUser();
    if (!user || user.role !== 'user') {
      alert('Silakan login sebagai pengguna untuk membuat pesanan.');
      navigateTo('auth-view');
      return;
    }

    const service = db.services.find((item) => item.id === state.selectedServiceId);
    if (!service) return;

    const order = {
      id: `ORD-${String(db.orders.length + 1).padStart(3, '0')}`,
      userId: user.id,
      serviceId: service.id,
      userIdTarget: document.getElementById('orderUserId').value.trim(),
      notes: document.getElementById('orderNotes').value.trim(),
      budget: getServiceBasePrice(service),
      status: 'Menunggu Penugasan',
      paymentStatus: 'Belum Dibayar',
      createdAt: new Date().toISOString().slice(0, 10),
      assignedJoki: service.joki
    };

    db.orders.unshift(order);
    persistData();
    renderAll();
    document.getElementById('paymentStatus').textContent = 'Pesanan dibuat dan menunggu penugasan. Pembayaran dilakukan lewat dashboard pengguna.';
    document.getElementById('paymentStatus').style.color = 'var(--success)';
    alert(`Pesanan ${order.id} berhasil dibuat. Status: Menunggu Penugasan`);
  });

  document.getElementById('sendChatBtn').addEventListener('click', () => {
    const input = document.getElementById('chatMessageInput');
    const message = input.value.trim();
    if (!message) return;
    db.chats.push({ id: `chat-${Date.now()}`, sender: 'user', message });
    db.chats.push({ id: `chat-${Date.now()}-support`, sender: 'support', message: 'Terima kasih, tim kami akan menindaklanjuti pesan ini.' });
    persistData();
    renderDetail();
    input.value = '';
  });

  document.getElementById('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    handleLogin(username, password);
  });

  document.getElementById('registerForm').addEventListener('submit', (event) => {
    event.preventDefault();
    registerUser(
      document.getElementById('registerUsername').value.trim(),
      document.getElementById('registerPassword').value.trim(),
      document.getElementById('registerName').value.trim(),
      document.getElementById('registerEmail').value.trim(),
      document.getElementById('registerPhone').value.trim()
    );
    document.getElementById('registerForm').reset();
  });

  document.getElementById('roleChangeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const selectedAccountKey = document.getElementById('ownerAccountSelect').value;
    const targetRole = document.getElementById('ownerTargetRole').value;

    if (!selectedAccountKey) {
      alert('Pilih akun yang akan diubah role-nya.');
      return;
    }

    switchAccountRole(selectedAccountKey, targetRole);
  });

  document.getElementById('createServiceForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = document.getElementById('ownerServiceTitle').value.trim();
    const category = document.getElementById('ownerServiceCategory').value.trim();
    const priceMin = document.getElementById('ownerServicePriceMin')?.value?.trim() || '';
    const priceMax = document.getElementById('ownerServicePriceMax')?.value?.trim() || '';

    const durationMin = document.getElementById('ownerServiceDurationMin')?.value?.trim() || '';
    const durationMax = document.getElementById('ownerServiceDurationMax')?.value?.trim() || '';

    const assignedJoki = '';

    const price = (priceMin && priceMax)
      ? `Rp ${priceMin} - ${priceMax}`
      : (document.getElementById('ownerServicePrice')?.value?.trim() || '');

    const duration = (durationMin && durationMax)
      ? `${durationMin}-${durationMax}`.replace(/\s+/g, '')
      : (document.getElementById('ownerServiceDuration')?.value?.trim() || '');
    const tag = document.getElementById('ownerServiceTag').value.trim();
    const status = document.getElementById('ownerServiceStatus').value;
    const description = document.getElementById('ownerServiceDescription').value.trim();
    const requirements = document.getElementById('ownerServiceRequirements').value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!title || !category || !price || !duration || !tag || !description) {
      alert('Lengkapi semua field layanan terlebih dahulu.');
      return;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layanan';
    const newService = {
      id: `${slug}-${Date.now()}`,
      title,
      category,
      price,
      duration,
      joki: assignedJoki,
      description,
      requirements,
      tag,
      status
    };

    db.services.push(newService);
    persistData();
    renderAll();
    document.getElementById('createServiceForm').reset();
    alert(`Layanan ${newService.title} berhasil ditambahkan.`);
  });

  // Owner joki creation handler removed

  document.getElementById('applyStatusBtn').addEventListener('click', () => {
    const selected = document.getElementById('orderSelect').value;
    const newStatus = document.getElementById('statusSelect').value;
    const order = db.orders.find((entry) => entry.id === selected);
    if (order) {
      order.status = newStatus;
      persistData();
      renderAll();
      alert(`Status pesanan ${selected} diperbarui menjadi ${newStatus}.`);
    }
  });
}

async function startApp() {
  await initializeFirebase();
  db = await loadData();
  if (firebaseEnabled) {
    subscribeFirebaseState();
  }
  state.currentUser = loadSession();
  attachEvents();
  renderAll();
  const defaultView = state.currentUser?.role === 'owner' ? 'owner-view' : state.currentUser?.role === 'admin' ? 'admin-view' : state.currentUser?.role === 'user' ? 'dashboard-view' : 'home-view';
  navigateTo(defaultView);
}

startApp();
