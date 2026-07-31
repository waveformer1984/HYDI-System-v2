(function (global) {
  const API = global.SWITCHBOARD_API || 'http://localhost:3001';

  function $(sel) { return document.querySelector(sel); }

  function statusBadge(status) {
    const s = String(status).toLowerCase();
    let cls = 'badge';
    if (s === 'open' || s === 'approved' || s === 'completed' || s === 'released' || s === 'signed') cls += ' success';
    else if (s === 'pending' || s === 'draft' || s === 'flagged' || s === 'quarantined') cls += ' warning';
    else if (s === 'rejected' || s === 'removed' || s === 'restricted' || s === 'removed') cls += ' error';
    else if (s === 'filled' || s === 'accepted') cls += ' primary';
    return `<span class="badge ${cls.split(' ').slice(1).join(' ')}">${status}</span>`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function setState(container, type, message) {
    const el = (typeof container === 'string' ? $(container) : container);
    if (!el) return;
    el.innerHTML = `<div class="alert ${type}" role="status">${message}</div>`;
  }

  function loading(container, text = 'Loading...') {
    const el = (typeof container === 'string' ? $(container) : container);
    if (!el) return;
    el.innerHTML = `<div class="loading"><div class="spinner" aria-hidden="true"></div><p>${text}</p></div>`;
  }

  function error(container, message, retry = null) {
    const el = (typeof container === 'string' ? $(container) : container);
    if (!el) return;
    const retryBtn = retry ? ` <button onclick="${retry}()">Retry</button>` : '';
    el.innerHTML = `<div class="alert error" role="alert">${message}${retryBtn}</div>`;
  }

  function empty(container, text = 'Nothing found.') {
    const el = (typeof container === 'string' ? $(container) : container);
    if (!el) return;
    el.innerHTML = `<div class="empty">${text}</div>`;
  }

  function success(container, text) {
    const el = (typeof container === 'string' ? $(container) : container);
    if (!el) return;
    el.innerHTML = `<div class="alert success" role="status">${text}</div>`;
    setTimeout(() => { if (el.firstElementChild) el.firstElementChild.remove(); }, 3000);
  }

  async function request(path, options = {}) {
    const url = `${API}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Request failed: ${res.status}`);
    return data;
  }

  function card(title, body) {
    return `<div class="card"><h2>${title}</h2>${body}</div>`;
  }

  function field(label, html) {
    return `<div class="field"><label>${label}</label>${html}</div>`;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', href: 'index.html' },
    { id: 'gigs', label: 'Gigs', href: 'index.html?view=gigs' },
    { id: 'applications', label: 'Applications', href: 'index.html?view=applications' },
    { id: 'trust', label: 'Trust', href: 'index.html?view=trust' },
    { id: 'availability', label: 'Availability', href: 'availability.html' },
    { id: 'messages', label: 'Messages', href: 'index.html?view=messages' },
    { id: 'moderation', label: 'Moderation', href: 'moderation.html' },
    { id: 'diagnostics', label: 'Diagnostics', href: 'diagnostics.html' },
    { id: 'profile', label: 'Profile', href: 'index.html?view=profile' }
  ];

  function renderNav(activeId) {
    const nav = $('nav');
    if (!nav) return;
    nav.innerHTML = `<ul role="menubar">${navItems.map(i => {
      const cls = i.id === activeId ? 'active' : '';
      return `<li role="none"><a role="menuitem" class="${cls}" href="${i.href}">${i.label}</a></li>`;
    }).join('')}</ul>`;
  }

  function toggleMenu() {
    const nav = $('nav');
    if (nav) nav.classList.toggle('open');
  }

  function initNav(activeId) {
    renderNav(activeId);
    const toggle = $('#menuToggle');
    if (toggle) toggle.addEventListener('click', toggleMenu);
    document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => {
      document.querySelector('nav')?.classList.remove('open');
    }));
  }

  global.SB = {
    API,
    $,
    statusBadge,
    formatDate,
    setState,
    loading,
    error,
    empty,
    success,
    request,
    card,
    field,
    renderNav,
    toggleMenu,
    initNav,
    navItems
  };
})(window);
