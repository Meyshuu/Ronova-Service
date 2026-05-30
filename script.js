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

  services: [],
  orders: [],
  chats: [],
  orderChats: [],
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
    commission: totalValue * 0.95
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
      <button class="nav-btn ${state.view === 'owner-trash-view' ? 'active' : ''}" data-view="owner-trash-view">Manage Joki</button>
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
  chatBox.innerHTML = db.chats.map((entry) => {
    const fileBlock = entry.attachment?.fileName
      ? `<div class="chat-attachment">📎 ${entry.attachment.fileName}</div>`
      : '';
    const text = entry.message ? entry.message : '';
    return `<div class="chat-bubble ${entry.sender}">${entry.sender === 'support' ? 'Support' : 'You'}: ${text}${fileBlock}</div>`;
  }).join('');
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
    const chatHint = document.getElementById('customerOrderChatHint');
    const chatBox = document.getElementById('customerOrderChatBox');
    if (chatBox) chatBox.innerHTML = '';
    if (chatHint) chatHint.textContent = 'Chat order hanya tersedia untuk pengguna.';
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
  document.getElementById('balanceMessage').textContent = 'Pembayaran dilakukan lewat Midtrans Snap. Klik Bayar via Midtrans untuk memproses pembayaran.';

  document.getElementById('balanceMessage').textContent = 'Pembayaran dilakukan lewat QRIS custom. Klik Bayar via QRIS untuk memproses pembayaran.';

  const userOrders = db.orders.filter((order) => order.userId === persistedUser.id);
  const chatBoxEl = document.getElementById('customerOrderChatBox');
  const chatHintEl = document.getElementById('customerOrderChatHint');
  const selectedOrderId = state.pendingOrderId || (userOrders[0] ? userOrders[0].id : null);

  if (!userOrders.length) {
    document.getElementById('userOrdersList').innerHTML = '<p class="body-copy">Belum ada pesanan.</p>';
    if (chatBoxEl) chatBoxEl.innerHTML = '';
    if (chatHintEl) chatHintEl.textContent = 'Buat pesanan terlebih dahulu untuk melihat chat order.';
  } else {
    document.getElementById('userOrdersList').innerHTML = userOrders.map((order) => {
      const service = db.services.find((item) => item.id === order.serviceId);
      const payButton = order.paymentStatus === 'Belum Dibayar'
        ? `<button class="small-btn pay-order-btn" data-order-id="${order.id}">Bayar via QRIS</button>`
        : '';
      const chatButton = `<button class="small-btn" data-chat-order-id="${order.id}">${order.id === selectedOrderId ? 'Chat (aktif)' : 'Buka chat'}</button>`;

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
          <div class="order-actions">${payButton} ${chatButton}</div>
        </article>
      `;
    }).join('');

    if (selectedOrderId) {
      // Keep state.pendingOrderId in sync so chat click + send works reliably
      state.pendingOrderId = selectedOrderId;
      renderCustomerOrderChat(selectedOrderId);
    }

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

      renderPayOrderUsingSaldo(order);
    });
  });

  document.querySelectorAll('[data-chat-order-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const orderId = button.dataset.chatOrderId;
      state.pendingOrderId = orderId;
      renderCustomerOrderChat(orderId);
    });
  });

  // kirim chat order (customer)
  const sendCustBtn = document.getElementById('sendCustomerOrderChatBtn');
  const custMsgInput = document.getElementById('customerOrderChatMessageInput');
  const custFileInput = document.getElementById('customerOrderChatFileInput');

  if (sendCustBtn && custMsgInput) {
    sendCustBtn.onclick = null;
    sendCustBtn.addEventListener('click', () => {
      const adminOrderId = state.pendingOrderId;
      if (!adminOrderId) {
        alert('Pilih order terlebih dahulu untuk chat.');
        return;
      }

      // Pastikan chat user benar-benar terkirim ke order yang sedang dipilih
      // (sebelumnya ada bug ketika selectedOrderId berubah tapi state.pendingOrderId belum tersinkron)
      if (typeof adminOrderId !== 'string' || !adminOrderId.trim()) {
        alert('Order yang dipilih tidak valid. Pilih ulang order-nya.');
        return;
      }

      const message = custMsgInput.value.trim();
      const file = custFileInput?.files?.[0] || null;
      if (!message && !file) return;


      if (file && !/^image\//.test(file.type)) {
        alert('Hanya file gambar yang diperbolehkan.');
        return;
      }

      const attachment = file
        ? { fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size || 0 }
        : null;

      db.orderChats = db.orderChats || [];
      db.orderChats.push({
        id: `orderchat-${Date.now()}`,
        orderId: adminOrderId,
        sender: 'customer',
        message,
        attachment,
        createdAt: new Date().toISOString()
      });

      persistData();
      renderCustomerOrderChat(adminOrderId);
      custMsgInput.value = '';
      if (custFileInput) custFileInput.value = '';
    });
  }
}

function renderCustomerOrderChat(orderId) {
  const chatBox = document.getElementById('customerOrderChatBox');
  const input = document.getElementById('customerOrderChatMessageInput');
  const fileInput = document.getElementById('customerOrderChatFileInput');
  const hintEl = document.getElementById('customerOrderChatHint');

  if (!chatBox) return;

  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    chatBox.innerHTML = '<p class="body-copy">Order tidak ditemukan.</p>';
    if (hintEl) hintEl.textContent = 'Pilih order yang valid untuk melihat chat.';
    if (input) input.disabled = true;
    if (fileInput) fileInput.disabled = true;
    return;
  }

  const chatEntries = (db.orderChats || []).filter((c) => c.orderId === orderId);
  const lines = chatEntries.map((c) => {
    const who = c.sender === 'admin' ? 'Admin' : 'Anda';
    const fileBlock = c.attachment?.fileName
      ? `<div class="chat-attachment">📎 ${c.attachment.fileName}</div>`
      : '';
    const text = c.message ? c.message : '';
    // bubble customer/admin format
    const bubbleRole = c.sender === 'admin' ? 'admin' : 'customer';
    return `<div class="chat-bubble ${bubbleRole}">${who}: ${text}${fileBlock}</div>`;
  }).join('');

  chatBox.innerHTML = lines || '<p class="body-copy">Belum ada chat untuk order ini.</p>';
  chatBox.scrollTop = chatBox.scrollHeight;

  const disabled = isOrderChatLocked(order);
  if (input) {
    input.disabled = disabled;
    input.placeholder = disabled ? 'Chat terkunci karena order selesai.' : 'Tulis pesan...';
  }
  if (fileInput) fileInput.disabled = disabled;
  if (hintEl) hintEl.textContent = ' ';
}

function renderPayOrderUsingSaldo(order) {
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

function renderAdmin(){

  const admin = getCurrentUser();
  const adminDashboardMetricsEl = document.getElementById('adminDashboardMetrics');
  const jokiDirectoryEl = document.getElementById('jokiDirectory');
  const adminOrdersListEl = document.getElementById('adminOrdersList');
  const orderSelectEl = document.getElementById('orderSelect');
  const chatBoxEl = document.getElementById('adminOrderChatBox');


  if (!admin || admin.role !== 'admin') {
    adminDashboardMetricsEl.innerHTML = '';
    if (jokiDirectoryEl) {
      jokiDirectoryEl.innerHTML = '<p class="body-copy">Akses admin hanya untuk administrator. Silakan login sebagai admin.</p>';
    }
    adminOrdersListEl.innerHTML = '<p class="body-copy">Tidak ada data pesanan untuk ditampilkan.</p>';
    orderSelectEl.innerHTML = '<option value="">Tidak ada pesanan</option>';
    if (chatBoxEl) chatBoxEl.innerHTML = '<p class="body-copy">Chat order tersedia saat memilih pesanan.</p>';
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
        <div class="order-actions">
          <button class="small-btn" onclick="adminSelectOrderChat('${order.id}')">Chat order</button>
        </div>
      </article>
    `;
  }).join('');


  const orderSelect = document.getElementById('orderSelect');
  orderSelect.innerHTML = db.orders.map((order) => `<option value="${order.id}">${order.id} - ${db.services.find((item) => item.id === order.serviceId)?.title || 'Layanan'}</option>`).join('');

  // auto-load chat for selected order (if any)
  if (chatBoxEl) {
    const selectedOrderId = orderSelectEl?.value || orderSelect?.value;
    if (selectedOrderId) adminRenderOrderChat(selectedOrderId);
    else chatBoxEl.innerHTML = '<p class="body-copy">Pilih pesanan untuk melihat chat.</p>';
  }
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
              ${o.status === 'Gagal' ? `<button class="small-btn" onclick="ownerReapplyFailedCompletion('${o.id}')">Ajukan ulang</button>` : ''}
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

function renderOwnerServicesTrashPage() {
  const owner = getCurrentUser();
  if (!owner || owner.role !== 'owner') {
    const el = document.getElementById('ownerServicesList');
    if (el) el.innerHTML = '<p class="body-copy">Akses hapus layanan hanya untuk owner.</p>';
    return;
  }

  const searchInput = document.getElementById('serviceSearchInput');
  const query = (searchInput?.value || '').toLowerCase().trim();

  const services = Array.isArray(db.services) ? db.services : [];
  const filtered = services.filter((s) => [s.title, s.category, s.tag, s.description].some((f) => String(f || '').toLowerCase().includes(query)));

  const listEl = document.getElementById('ownerServicesList');
  if (!listEl) return;

  listEl.innerHTML = filtered.length
    ? filtered.map((service) => `
        <article class="order-item">
          <div class="order-head">
            <strong>${service.title}</strong>
            <div class="order-badges">
              <span class="status-badge success">${service.category}</span>
              <span class="status-badge ${service.status === 'Tersedia' ? 'success' : 'failed'}">${service.status}</span>
            </div>
          </div>
          <div class="order-body">
            <span class="item-subtle">Harga: ${service.price || '-'}</span>
            <span class="item-subtle">Durasi: ${service.duration || '-'}</span>
            <span class="item-subtle">Tag: ${service.tag || '-'}</span>
            <span class="item-subtle">ID: ${service.id}</span>
          </div>
          <div class="order-actions">
            <button class="small-btn danger" onclick="ownerDeleteService('${service.id}')">Hapus layanan</button>
          </div>
        </article>
      `).join('')
    : '<p class="body-copy">Tidak ada layanan.</p>';
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
  order.completionRequest = order.completionRequest || {};
  order.completionRequest.rejectedAt = new Date().toISOString();
  persistData();
  renderAll();
  alert(`Order ${orderId} ditolak dan ditandai gagal oleh owner.`);
}

function ownerReapplyFailedCompletion(orderId) {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return alert('Order tidak ditemukan.');
  if (order.status !== 'Gagal') return alert('Order harus berstatus Gagal.');

  order.status = 'Menunggu Konfirmasi Owner';
  order.completionRequest = order.completionRequest || {};
  order.completionRequest.reappliedAt = new Date().toISOString();
  persistData();
  renderAll();
  alert(`Order ${orderId} diajukan ulang ke owner.`);
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

function ownerDeleteService(serviceId) {
  const service = db.services.find((s) => s.id === serviceId);
  if (!service) return alert('Layanan tidak ditemukan.');

  const confirmText = `Hapus layanan:\n${service.title}\nID: ${service.id}\n\nAksi ini akan:\n- Menghapus service dari daftar layanan\n- Order yang sudah ada tetap tersimpan (hanya tampilan layanan bisa kosong)\n\nLanjutkan?`;
  if (!confirm(confirmText)) return;

  db.services = (db.services || []).filter((s) => s.id !== serviceId);
  persistData();
  renderAll();
  alert(`Layanan ${service.title} berhasil dihapus.`);
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

function isOrderChatLocked(order) {
  // Rule: chat terkunci hanya saat order status "Berhasil".
  // Payment "Dibayar" tidak mengunci chat.
  return order?.status === 'Berhasil';
}

function adminRenderOrderChat(orderId) {
  const chatBox = document.getElementById('adminOrderChatBox');
  const input = document.getElementById('adminOrderChatMessageInput');
  const fileInput = document.getElementById('adminOrderChatFileInput');
  if (!chatBox) return;

  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    chatBox.innerHTML = '<p class="body-copy">Order tidak ditemukan.</p>';
    return;
  }

  const chatEntries = (db.orderChats || []).filter((c) => c.orderId === orderId);
  const lines = chatEntries.map((c) => {
    const who = c.sender === 'admin' ? 'Admin' : 'Customer';
    const fileBlock = c.attachment?.fileName
      ? `<div class="chat-attachment">📎 ${c.attachment.fileName}</div>`
      : '';
    const text = c.message ? c.message : '';
    return `<div class="chat-bubble ${c.sender === 'admin' ? 'admin' : 'customer'}">${who}: ${text}${fileBlock}</div>`;
  }).join('');

  chatBox.innerHTML = lines || '<p class="body-copy">Belum ada chat untuk order ini.</p>';
  chatBox.scrollTop = chatBox.scrollHeight;

  // Lock chat only when order status marked as Berhasil.
  const disabled = isOrderChatLocked(order);
  if (input) {
    input.disabled = disabled;
    input.placeholder = disabled ? 'Chat terkunci karena order selesai.' : 'Tulis pesan untuk customer...';
  }
  if (fileInput) fileInput.disabled = disabled;
}


function adminSelectOrderChat(orderId) {
  const orderSelect = document.getElementById('orderSelect');
  if (orderSelect) {
    orderSelect.value = orderId;
  }

  // Prefill final price input from order.budget (existing field)
  const priceInput = document.getElementById('adminOrderFinalPrice');
  const order = db.orders.find((o) => o.id === orderId);
  if (priceInput && order) {
    priceInput.value = order.budget != null ? String(order.budget) : '';
  }

  adminRenderOrderChat(orderId);
}


function adminConfirmPriceAndPayment(orderId) {
  const admin = getCurrentUser();
  if (!admin || admin.role !== 'admin') {
    return alert('Akses hanya untuk admin.');
  }

  const order = db.orders.find((entry) => entry.id === orderId);
  if (!order) {
    return alert('Order tidak ditemukan.');
  }

  const priceInput = document.getElementById('adminOrderFinalPrice');
  const msgEl = document.getElementById('adminPricePaymentMsg');
  if (!priceInput) return;

  const raw = priceInput.value;
  const finalPrice = Number(raw);
  if (!raw || Number.isNaN(finalPrice) || finalPrice <= 0) {
    if (msgEl) msgEl.textContent = 'Harga final harus diisi dengan angka > 0.';
    alert('Harga final harus diisi dengan angka > 0.');
    return;
  }

  order.budget = finalPrice;
  // Ensure customer can pay via dashboard
  if (!order.paymentStatus || order.paymentStatus === 'Dibayar') {
    order.paymentStatus = 'Belum Dibayar';
  } else {
    order.paymentStatus = 'Belum Dibayar';
  }
  // If order previously in completion flow, keep status as is.

  // NOTE: Sesuai requirement: adminConfirmPrice hanya update budget & paymentStatus.
  // order.status tidak diubah.

  persistData();
  renderAll();


  if (msgEl) msgEl.textContent = `Harga final dikonfirmasi: ${formatCurrency(finalPrice)}. Customer bisa bayar via QRIS di dashboard.`;
  alert(`Harga final untuk ${orderId} dikonfirmasi. Customer bisa bayar via QRIS di dashboard.`);
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
  renderOwnerServicesTrashPage();
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

  const serviceSearchInput = document.getElementById('serviceSearchInput');
  if (serviceSearchInput) {
    serviceSearchInput.addEventListener('input', () => {
      renderOwnerServicesTrashPage();
    });
  }


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
    const fileInput = document.getElementById('chatFileInput');
    const message = input.value.trim();
    const file = fileInput?.files?.[0] || null;
    if (!message && !file) return;

      const isAllowed = file && /^image\//.test(file.type);
      if (file && !isAllowed) {
        alert('Hanya file gambar yang diperbolehkan (jpg/png/jpeg/gif/webp).');
        return;
      }
      const attachment = file
        ? { fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size || 0 }
        : null;

    db.chats.push({ id: `chat-${Date.now()}`, sender: 'user', message, attachment });
    db.chats.push({ id: `chat-${Date.now()}-support`, sender: 'support', message: 'Terima kasih, tim kami akan menindaklanjuti pesan ini.', attachment: null });
    persistData();
    renderDetail();
    input.value = '';
    if (fileInput) fileInput.value = '';
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

  // Admin: konfirmasi harga & pembayaran
  const confirmPriceBtn = document.getElementById('adminConfirmPricePaymentBtn');
  const priceInputEl = document.getElementById('adminOrderFinalPrice');
  if (confirmPriceBtn && priceInputEl) {
    confirmPriceBtn.addEventListener('click', () => {
      const orderId = document.getElementById('orderSelect')?.value;
      if (!orderId) {
        alert('Pilih pesanan terlebih dahulu.');
        return;
      }
      adminConfirmPriceAndPayment(orderId);
    });
  }

  const adminMarkPaidBtn = document.getElementById('adminMarkPaidBtn');
  if (adminMarkPaidBtn) {
    adminMarkPaidBtn.addEventListener('click', () => {
      const orderId = document.getElementById('orderSelect')?.value;
      if (!orderId) return alert('Pilih pesanan terlebih dahulu.');
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) return alert('Order tidak ditemukan.');
      order.paymentStatus = 'Dibayar';
      order.paymentMethod = 'Admin';
      order.paidAt = new Date().toISOString();
      persistData();
      renderAll();
      alert(`Order ${orderId} ditandai dibayar.`);
    });
  }


  const sendBtn = document.getElementById('sendAdminOrderChatBtn');
  const inputEl = document.getElementById('adminOrderChatMessageInput');
  const fileInputEl = document.getElementById('adminOrderChatFileInput');

  if (sendBtn && inputEl) {
    sendBtn.addEventListener('click', () => {
      const admin = getCurrentUser();
      if (!admin || admin.role !== 'admin') return;


      const orderSelect = document.getElementById('orderSelect');
      const orderId = orderSelect?.value;
      if (!orderId) {
        alert('Pilih pesanan terlebih dahulu.');
        return;
      }

      const message = inputEl.value.trim();
      const file = fileInputEl?.files?.[0] || null;
      if (!message && !file) return;

      const order = db.orders.find((o) => o.id === orderId);
      if (!order) return;
      // Lock sending only when order finished (Berhasil)
      if (order.status === 'Berhasil') {
        alert('Chat terkunci karena order selesai.');
        return;
      }

      db.orderChats = db.orderChats || [];
      const attachment = file
        ? { fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size || 0 }
        : null;

      db.orderChats.push({
        id: `orderchat-${Date.now()}`,
        orderId,
        sender: 'admin',
        message,
        attachment,
        createdAt: new Date().toISOString()
      });

      inputEl.value = '';
      persistData();
      adminRenderOrderChat(orderId);

      // (customer reply dapat ditambahkan kemudian bila diperlukan)
    });
  }

  // lock chat customer when order is Berhasil
  if (sendCustBtn && custMsgInput) {
    const fileEl = document.getElementById('customerOrderChatFileInput');
    const selectedOrder = db.orders.find((o) => o.id === state.pendingOrderId);
    const disabled = isOrderChatLocked(selectedOrder);
    custMsgInput.disabled = disabled;
    if (fileEl) fileEl.disabled = disabled;
    custMsgInput.placeholder = disabled ? 'Chat terkunci karena order selesai.' : 'Tulis pesan...';
  }

  // top up saldo (demo)
  const topUpBtn = document.getElementById('topUpBtn');
  const topUpAmountEl = document.getElementById('topUpAmount');
  if (topUpBtn && topUpAmountEl) {
    topUpBtn.addEventListener('click', () => {
      const amt = topUpAmountEl.value;
      topUpBalance(amt);
      topUpAmountEl.value = '';
    });
  }
}

async function startApp() {
  await initializeFirebase();
  db = await loadData();
  if (firebaseEnabled) {
    subscribeFirebaseState();
  }
  state.currentUser = loadSession();

  attachEvents();

  // guard: jika belum login, paksa ke auth view
  if (!state.currentUser) {
    renderAll();
    navigateTo('auth-view');
    return;
  }

  renderAll();
  const defaultView = state.currentUser?.role === 'owner' ? 'owner-view' : state.currentUser?.role === 'admin' ? 'admin-view' : state.currentUser?.role === 'user' ? 'dashboard-view' : 'home-view';
  navigateTo(defaultView);
}

function _toastTypeFromMessage(message) {
  const msg = String(message || '').toLowerCase();
  const isError = /(gagal|tidak|error|invalid|bukan ditemukan|belum)/.test(msg);
  if (isError) return 'error';
  const isSuccess = /(berhasil|terkonfirmasi|dikonfirmasi|ditandai|selesai|sukses|aktif|tepat)/.test(msg);
  if (isSuccess) return 'success';
  return 'info';
}

function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type || _toastTypeFromMessage(message)}`;
  toast.textContent = String(message || '');
  container.appendChild(toast);

  const timeout = 2600;
  window.setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, timeout);
}

function topUpBalance(amount) {
  const user = getCurrentUser();
  if (!user || user.role !== 'user') {
    return alert('Akses hanya untuk pengguna.');
  }

  const persistedUser = db.users.find((entry) => entry.id === user.id);
  if (!persistedUser) {
    return alert('User tidak ditemukan.');
  }

  const finalAmount = Number(amount);
  if (!Number.isFinite(finalAmount) || finalAmount < 1000) {
    return alert('Nominal top up minimal 1000 IDR.');
  }

  // Create a topup record (will be applied by webhook after MIDTRANS confirms paid)
  const topUpId = `topup-${Date.now()}`;
  db.topUps = db.topUps || [];
  db.topUps.push({
    id: topUpId,
    userId: persistedUser.id,
    amount: finalAmount,
    status: 'pending',
    provider: 'MIDTRANS',
    createdAt: new Date().toISOString(),
    applied: false
  });

  // IMPORTANT: persist first so webhook can find topUp in Firestore/state.
  persistData();

  // Midtrans create snap (server will return snapToken)
  fetch(`${QRIS_SERVER_URL}/midtrans/create-snap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: topUpId,
      amount: finalAmount,
      description: `Top up saldo ${finalAmount} untuk ${persistedUser.username}`
    })
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      if (!data?.snapToken) throw new Error('Missing snapToken');

      // IMPORTANT (Vercel): jangan buka endpoint simulasi yang belum pasti ada.
      // Tampilkan feedback dulu.
      showToast('Snap token berhasil dibuat. Lanjutkan pembayaran di Midtrans.', 'success');

      // Placeholder: production harus pakai Midtrans Snap JS + snapToken.
      // Untuk saat ini, kita arahkan user ke halaman QRIS/manual fallback bila kamu sudah siapkan.
      // Jika backend kamu menyediakan route berikut, browser akan membuka; kalau tidak, tetap tidak diam-diam.
      const simulateUrl = `${QRIS_SERVER_URL}/midtrans/simulate/${encodeURIComponent(topUpId)}`;
      try {
        window.open(simulateUrl, '_blank');
      } catch (e) {
        // ignore
      }
    })
    .catch((err) => {
      console.warn('midtrans create-snap failed', err);
      showToast(`Gagal memulai top up via Midtrans: ${err?.message || err}`, 'error');
      alert('Gagal memulai top up via Midtrans. Silakan coba lagi.');
    });
}




// Replace native alerts with toast (confirm remains native)
(function patchAlertsToToasts() {
  const oldAlert = window.alert;
  window.alert = function (msg) {
    showToast(msg, _toastTypeFromMessage(msg));
    return undefined;
  };
})();

startApp();

