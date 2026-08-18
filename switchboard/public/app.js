const API = window.SWITCHBOARD_API || 'http://localhost:3001';
let currentUser = null;

const app = document.getElementById('app');

function show(view) {
  app.innerHTML = '';
  switch (view) {
    case 'login': renderLogin(); break;
    case 'dashboard': renderDashboard(); break;
    case 'gigs': renderGigs(); break;
    case 'gig': renderGig(); break;
    case 'profile': renderProfile(); break;
    case 'messages': renderMessages(); break;
    case 'applications': renderApplications(); break;
    case 'trust': renderTrust(); break;
    case 'parent': renderParentApproval(); break;
  }
  localStorage.setItem('view', view);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderLogin() {
  app.innerHTML = `
    <div class="card">
      <h2>Login</h2>
      <input type="email" id="email" placeholder="Email" />
      <input type="password" id="password" placeholder="Password" />
      <button id="loginBtn">Login</button>
    </div>
  `;
  document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const users = await api('/users');
      const found = users.find(u => u.email === email);
      if (!found) throw new Error('No user found');
      currentUser = found;
      localStorage.setItem('currentUser', JSON.stringify(found));
      show('dashboard');
    } catch (e) { SB.error('#feedback', e.message); }
  };
}

async function renderDashboard() {
  if (!currentUser) { show('login'); return; }
  app.innerHTML = `<div class="card"><h2>Dashboard</h2><p>Welcome, ${currentUser.name}</p><button onclick="show('gigs')">Find Gigs</button></div>`;
  if (currentUser.role === 'performer') {
    const recs = await api(`/match/gigs/${currentUser.id}`);
    app.innerHTML += `<div class="card"><h3>Recommended Gigs</h3>${recs.map(r => `
      <div class="card" onclick="showGig('${r.gig.id}')">
        <strong>${r.gig.title}</strong>
        <span class="score">Score ${(r.total * 100).toFixed(0)}%</span>
        <p>${r.factors.map(f => `${f.name}: ${(f.score * 100).toFixed(0)}%`).join(', ')}</p>
      </div>
    `).join('')}</div>`;
  }
}

async function renderGigs() {
  if (!currentUser) { show('login'); return; }
  const gigs = await api('/gigs');
  app.innerHTML = `<div class="card"><h2>Gig Feed</h2>${gigs.map(g => `
    <div class="card" onclick="showGig('${g.id}')">
      <strong>${g.title}</strong>
      <p>${g.description || ''}</p>
      <small>${g.start_time} — $${g.budget || 0}</small>
    </div>
  `).join('')}</div>`;
}

window.showGig = async (id) => {
  const gig = await api(`/gigs/${id}`);
  app.innerHTML = `<div class="card">
    <h2>${gig.title}</h2>
    <p>${gig.description || ''}</p>
    <p>Skills: ${gig.required_skills.join(', ') || 'None'}</p>
    <p>${gig.start_time} to ${gig.end_time}</p>
    <p>Budget: $${gig.budget || 0}</p>
    <h3>Apply</h3>
    <textarea id="note" placeholder="Note to venue"></textarea>
    <button onclick="applyForGig('${gig.id}')">Apply</button>
  </div>`;
};

window.applyForGig = async (gigId) => {
  const note = document.getElementById('note').value;
  try {
    await api(`/gigs/${gigId}/apply`, { method: 'POST', body: JSON.stringify({ user_id: currentUser.id, note }) });
    SB.success('#feedback', 'Application submitted');
  } catch (e) { SB.error('#feedback', e.message); }
};

async function renderProfile() {
  if (!currentUser) { show('login'); return; }
  app.innerHTML = `<div class="card">
    <h2>Profile</h2>
    <p><strong>Name:</strong> ${currentUser.name}</p>
    <p><strong>Email:</strong> ${currentUser.email}</p>
    <p><strong>Role:</strong> ${currentUser.role}</p>
    <p><strong>Skills:</strong> ${currentUser.skills.join(', ')}</p>
    <p><strong>Protected:</strong> ${currentUser.protected_account ? 'Yes' : 'No'}</p>
  </div>`;
}

async function renderMessages() {
  if (!currentUser) { show('login'); return; }
  const users = await api('/users');
  app.innerHTML = `<div class="card">
    <h2>Messages</h2>
    <select id="recipient"><option value="">Select recipient</option>${users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}</select>
    <div id="msgThread"></div>
    <textarea id="msgBody"></textarea>
    <button onclick="sendMessage()">Send</button>
  </div>`;
  window.sendMessage = async () => {
    const recipientId = document.getElementById('recipient').value;
    const content = document.getElementById('msgBody').value;
    if (!recipientId || !content) return;
    try {
      await api('/messages', { method: 'POST', body: JSON.stringify({ sender_id: currentUser.id, recipient_id: recipientId, content }) });
      loadThread(recipientId);
    } catch (e) { SB.error('#feedback', e.message); }
  };
  document.getElementById('recipient').onchange = (e) => loadThread(e.target.value);
}

async function loadThread(recipientId) {
  if (!recipientId) return;
  const thread = await api(`/messages/${currentUser.id}/${recipientId}`);
  document.getElementById('msgThread').innerHTML = thread.map(m => `
    <div class="card" style="background:${m.quarantined ? '#ffeaea' : '#fff'}">
      <strong>${m.sender_id === currentUser.id ? 'Me' : 'Them'}</strong>
      <p>${m.content}</p>
      ${m.quarantined ? '<small style="color:red">Quarantined</small>' : ''}
    </div>
  `).join('');
}

async function renderApplications() {
  if (!currentUser) { show('login'); return; }
  const apps = [];
  const gigs = await api('/gigs');
  for (const g of gigs) {
    const ranked = await api(`/gigs/${g.id}/applications`);
    apps.push(...ranked);
  }
  app.innerHTML = `<div class="card"><h2>Applications</h2>${apps.map(a => `
    <div class="card">
      <strong>Gig:</strong> ${a.gig ? a.gig.title : a.application.gig_id}<br>
      <strong>Applicant:</strong> ${a.user ? a.user.name : a.application.user_id}<br>
      <strong>Score:</strong> <span class="score">${(a.total * 100).toFixed(0)}%</span><br>
      <strong>Status:</strong> ${a.application.status}
      ${currentUser.role === 'venue' && a.application.status === 'pending' ? `<br><button onclick="acceptApp('${a.application.id}')">Accept</button> <button onclick="declineApp('${a.application.id}')">Decline</button>` : ''}
    </div>
  `).join('')}</div>`;
}

window.acceptApp = async (id) => {
  try { await api(`/applications/${id}/accept`, { method: 'POST', body: JSON.stringify({}) }); SB.success('#feedback', 'Accepted'); show('applications'); }
  catch (e) { SB.error('#feedback', e.message); }
};
window.declineApp = async (id) => {
  try { await api(`/applications/${id}/decline`, { method: 'POST', body: JSON.stringify({}) }); SB.success('#feedback', 'Declined'); show('applications'); }
  catch (e) { SB.error('#feedback', e.message); }
};

async function renderTrust() {
  if (!currentUser) { show('login'); return; }
  const contracts = await api('/contracts');
  const payments = await api('/payments');
  const mine = contracts.filter(c => c.performer_id === currentUser.id || c.venue_id === currentUser.id);
  const minePayments = payments.filter(p => p.paid_by === currentUser.id || p.paid_to === currentUser.id);

  app.innerHTML = `
    <div class="card">
      <h2>Trust & Commerce</h2>
      <h3>My Contracts</h3>
      ${mine.map(c => `
        <div class="card">
          <strong>Gig:</strong> ${c.gig_id}<br>
          <strong>Amount:</strong> $${c.amount || 0}<br>
          <strong>Status:</strong> ${c.status}<br>
          <strong>Performer signed:</strong> ${c.performer_signed ? 'Yes' : 'No'}<br>
          <strong>Venue signed:</strong> ${c.venue_signed ? 'Yes' : 'No'}<br>
          ${c.status === 'draft' ? `<button onclick="signContract('${c.id}')">Sign</button>` : ''}
          ${currentUser.role === 'venue' && c.status === 'signed' ? `<button onclick="completeContract('${c.id}')">Complete</button>` : ''}
          ${c.status === 'completed' ? `<button onclick="showRate('${c.id}')">Rate</button>` : ''}
        </div>
      `).join('')}
      <h3>My Payments</h3>
      ${minePayments.map(p => `
        <div class="card">
          <strong>Amount:</strong> $${p.amount}<br>
          <strong>Status:</strong> ${p.status}<br>
          ${currentUser.role === 'venue' && p.status === 'pending' ? `<button onclick="releasePayment('${p.id}')">Release</button>` : ''}
        </div>
      `).join('')}
      <div id="rateForm"></div>
    </div>
  `;
}

window.signContract = async (id) => {
  try { await api(`/contracts/${id}/sign`, { method: 'POST', body: JSON.stringify({ user_id: currentUser.id }) }); SB.success('#feedback', 'Signed'); show('trust'); }
  catch (e) { SB.error('#feedback', e.message); }
};
window.completeContract = async (id) => {
  try { await api(`/contracts/${id}/complete`, { method: 'POST', body: JSON.stringify({}) }); SB.success('#feedback', 'Completed'); show('trust'); }
  catch (e) { SB.error('#feedback', e.message); }
};
window.releasePayment = async (id) => {
  try { await api(`/payments/${id}/release`, { method: 'POST', body: JSON.stringify({}) }); SB.success('#feedback', 'Released'); show('trust'); }
  catch (e) { SB.error('#feedback', e.message); }
};
window.showRate = (cid) => {
  window.rateCid = cid;
  document.getElementById('rateForm').innerHTML = `
    <div class="card">
      <h3>Submit Rating</h3>
      <input type="text" id="rateeId" placeholder="Ratee user ID" />
      <input type="number" id="score" min="1" max="5" value="5" />
      <textarea id="comment" placeholder="Comment"></textarea>
      <button id="rateBtn">Submit</button>
    </div>
  `;
  document.getElementById('rateBtn').onclick = async () => {
    const rateeId = document.getElementById('rateeId').value;
    const score = parseInt(document.getElementById('score').value, 10);
    const comment = document.getElementById('comment').value;
    try {
      await api('/ratings', { method: 'POST', body: JSON.stringify({ contract_id: window.rateCid, rater_id: currentUser.id, ratee_id: rateeId, score, comment }) });
      SB.success('#feedback', 'Rating submitted');
      show('trust');
    } catch (e) { SB.error('#feedback', e.message); }
  };
};

async function renderParentApproval() {
  if (!currentUser) { show('login'); return; }
  app.innerHTML = `
    <div class="card">
      <h2>Parent Approval</h2>
      <p>Your email: ${currentUser.email}</p>
      <input type="email" id="childEmail" placeholder="Child's email" />
      <button id="approveBtn">Approve</button>
      <div id="approveResult"></div>
    </div>
  `;
  document.getElementById('approveBtn').onclick = async () => {
    const email = document.getElementById('childEmail').value;
    try {
      const users = await api('/users');
      const child = users.find(u => u.email === email);
      if (!child) throw new Error('Child not found');
      const res = await api(`/users/${child.id}/parent-approve`, { method: 'POST', body: JSON.stringify({ parent_email: currentUser.email }) });
      document.getElementById('approveResult').innerHTML = `<p>Approved ${res.applicationsApproved} application(s).</p>`;
    } catch (e) { SB.error('#feedback', e.message); }
  };
}

currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
const saved = localStorage.getItem('view') || 'login';
show(saved);
