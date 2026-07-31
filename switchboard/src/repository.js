const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createStore } = require('./persistence');
const { EventBus, MemoryTransport, FileTransport } = require('./events/event-bus');
const validation = require('./validation');
const { NotFoundError, ValidationError, ConflictError } = require('./errors');

const saltRounds = 10;

function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }

function parseJson(json, fallback) {
  if (json == null) return fallback;
  if (typeof json === 'object') return json;
  try { return JSON.parse(json); } catch { return fallback; }
}

function rowUser(r) {
  if (!r) return null;
  const copy = { ...r };
  delete copy.password_hash;
  copy.protected_account = Boolean(copy.protected_account);
  copy.parent_approved = Boolean(copy.parent_approved);
  copy.skills = parseJson(copy.skills, []);
  return copy;
}

function rowGig(g) { return g ? { ...g, required_skills: parseJson(g.required_skills, []) } : null; }

function ensureFound(record, message) {
  if (!record) throw new NotFoundError(message);
  return record;
}

class Repository {
  constructor(store, eventBus, logger) {
    this.store = store;
    this.eventBus = eventBus || new EventBus();
    this.logger = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  async init() { await this.store.init(); }

  audit(table, recordId, action, actorId, oldData, newData) {
    const record = {
      id: id(), table_name: table, record_id: recordId, action,
      actor_id: actorId || null, old_data: oldData || null, new_data: newData || null, created_at: now()
    };
    this.store.create('audit_log', record);
    return record;
  }

  async createUser(input) {
    const v = validation.validateUser(input);
    const existing = this.store.getAll('users').find(u => u.email === v.email);
    if (existing) throw new ConflictError('Email already registered');
    const hash = await bcrypt.hash(v.password, saltRounds);
    const user = {
      id: id(), email: v.email, password_hash: hash, name: v.name, role: v.role,
      age: v.age,
      protected_account: v.age && v.age <= 15 ? 1 : 0,
      parent_email: v.parent_email,
      parent_approved: v.parent_approved ? 1 : 0,
      skills: JSON.stringify(v.skills),
      latitude: v.latitude,
      longitude: v.longitude,
      bio: v.bio,
      created_at: now()
    };
    this.store.create('users', user);
    this.audit('users', user.id, 'created', user.id, null, { email: user.email, name: user.name });
    this.eventBus.emit('user.created', rowUser(user));
    this.logger.info('repository', 'user.created', `User ${user.id} created`, { userId: user.id });
    return rowUser(user);
  }

  getUser(uid) { return rowUser(this.store.getById('users', uid)); }
  getUsers() { return this.store.getAll('users').map(u => rowUser({ ...u })); }

  updateUser(uid, updates) {
    const old = ensureFound(this.store.getById('users', uid), 'User not found');
    const updated = { ...old };
    if (updates.name != null) updated.name = validation.requireString({ name: updates.name }, 'name', { min: 1, max: 128 });
    if (updates.age != null) { updated.age = validation.requireInteger({ age: updates.age }, 'age', { min: 1, max: 120 }); updated.protected_account = updated.age <= 15 ? 1 : 0; }
    if (updates.parent_email != null) updated.parent_email = validation.optionalString({ parent_email: updates.parent_email }, 'parent_email', { email: true });
    if (updates.parent_approved != null) updated.parent_approved = updates.parent_approved ? 1 : 0;
    if (updates.skills != null) updated.skills = JSON.stringify(Array.isArray(updates.skills) ? updates.skills : []);
    if (updates.latitude != null) updated.latitude = validation.requireNumber({ latitude: updates.latitude }, 'latitude', { min: -90, max: 90 });
    if (updates.longitude != null) updated.longitude = validation.requireNumber({ longitude: updates.longitude }, 'longitude', { min: -180, max: 180 });
    if (updates.bio != null) updated.bio = validation.optionalString({ bio: updates.bio }, 'bio', { max: 2048 });
    this.store.update('users', uid, updated);
    this.audit('users', uid, 'updated', uid, rowUser({ ...old }), rowUser({ ...updated }));
    this.eventBus.emit('user.updated', rowUser(updated));
    this.logger.info('repository', 'user.updated', `User ${uid} updated`);
    return rowUser(updated);
  }

  approveParent(uid, parentEmail) {
    validation.requireString({ parent_email: parentEmail }, 'parent_email', { email: true });
    const user = ensureFound(this.store.getById('users', uid), 'User not found');
    if (user.parent_email !== parentEmail) throw new ValidationError('Parent email does not match', 'parent_email');
    const updated = { ...user, parent_approved: 1 };
    this.store.update('users', uid, updated);
    this.audit('users', uid, 'parent_approved', parentEmail, rowUser({ ...user }), rowUser({ ...updated }));
    this.eventBus.emit('user.parent_approved', rowUser(updated));
    this.logger.info('repository', 'user.parent_approved', `User ${uid} parent approved`);

    const apps = this.store.getAll('applications').filter(a => a.user_id === uid && a.status === 'pending_approval');
    apps.forEach(a => {
      const next = { ...a, status: 'pending', parent_approved: 1 };
      this.store.update('applications', a.id, next);
      this.audit('applications', a.id, 'parent_approved', uid, a, next);
      this.eventBus.emit('application.parent_approved', { ...next });
    });

    return { user: rowUser(updated), applicationsApproved: apps.length };
  }

  createVenue(input) {
    const v = validation.validateVenue(input);
    const venue = { id: id(), owner_id: v.owner_id, name: v.name, address: v.address, latitude: v.latitude, longitude: v.longitude, contact_email: v.contact_email };
    this.store.create('venues', venue);
    this.audit('venues', venue.id, 'created', v.owner_id, null, venue);
    this.eventBus.emit('venue.created', venue);
    this.logger.info('repository', 'venue.created', `Venue ${venue.id} created`);
    return { ...venue };
  }

  getVenues() { return this.store.getAll('venues').map(v => ({ ...v })); }
  getVenue(vid) { const v = this.store.getById('venues', vid); return v ? { ...v } : null; }

  createGig(input) {
    const v = validation.validateGig(input);
    const gig = {
      id: id(), venue_id: v.venue_id, title: v.title, description: v.description,
      required_skills: JSON.stringify(v.required_skills),
      start_time: v.start_time, end_time: v.end_time,
      min_age: v.min_age, max_age: v.max_age,
      latitude: v.latitude, longitude: v.longitude,
      budget: v.budget, status: 'open'
    };
    this.store.create('gigs', gig);
    this.audit('gigs', gig.id, 'created', v.owner_id, null, gig);
    this.eventBus.emit('gig.created', rowGig(gig));
    this.logger.info('repository', 'gig.created', `Gig ${gig.id} created`);
    return rowGig(gig);
  }

  getGig(gid) { return rowGig(this.store.getById('gigs', gid)); }
  getGigs() { return this.store.getAll('gigs').map(rowGig); }
  searchGigs(q) {
    validation.requireString({ q }, 'q');
    const term = q.toLowerCase();
    return this.getGigs().filter(g =>
      (g.title && g.title.toLowerCase().includes(term)) || (g.description && g.description.toLowerCase().includes(term))
    );
  }

  createApplication(input) {
    const gigId = validation.requireString(input, 'gig_id');
    const userId = validation.requireString(input, 'user_id');
    const note = validation.optionalString(input, 'note', { max: 2000 });
    const app = {
      id: id(), gig_id: gigId, user_id: userId, note,
      status: input.status || 'pending', created_at: now(),
      parent_approved: input.parent_approved ? 1 : 0,
      quarantined: input.quarantined ? 1 : 0, no_show: input.no_show || 0, late: input.late || 0
    };
    this.store.create('applications', app);
    this.audit('applications', app.id, 'created', userId, null, app);
    this.eventBus.emit('application.submitted', { ...app });
    this.logger.info('repository', 'application.submitted', `Application ${app.id} submitted`);
    return { ...app };
  }

  getApplicationsForGig(gid) { return this.store.getAll('applications').filter(a => a.gig_id === gid).map(a => ({ ...a })); }

  updateApplicationStatus(aid, status) {
    const old = ensureFound(this.store.getById('applications', aid), 'Application not found');
    const updated = { ...old, status };
    this.store.update('applications', aid, updated);
    this.audit('applications', aid, 'status_change', null, old, updated);
    this.eventBus.emit('application.status_changed', { ...updated });
    this.logger.info('repository', 'application.status_changed', `Application ${aid} -> ${status}`);
    return { ...updated };
  }

  createMessage(input) {
    const sender = validation.requireString(input, 'sender_id');
    const recipient = validation.requireString(input, 'recipient_id');
    const content = validation.requireString(input, 'content', { min: 1, max: 4000 });
    const msg = {
      id: id(), sender_id: sender, recipient_id: recipient,
      gig_id: input.gig_id || null, content,
      quarantined: input.quarantined ? 1 : 0, created_at: now()
    };
    this.store.create('messages', msg);
    this.eventBus.emit('message.sent', { ...msg });
    this.logger.info('repository', 'message.sent', `Message ${msg.id} sent`);
    return { ...msg };
  }

  getMessages(u1, u2) {
    validation.requireString({ u1 }, 'u1');
    validation.requireString({ u2 }, 'u2');
    return this.store.getAll('messages').filter(m =>
      (m.sender_id === u1 && m.recipient_id === u2) || (m.sender_id === u2 && m.recipient_id === u1)
    ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  createAvailability(input) {
    const userId = validation.requireString(input, 'user_id');
    const start = validation.requireDate(input, 'start_time');
    const end = validation.requireDate(input, 'end_time');
    if (new Date(end) <= new Date(start)) throw new ValidationError('End time must be after start time', 'end_time');
    const avail = { id: id(), user_id: userId, start_time: start, end_time: end };
    this.store.create('availability', avail);
    this.eventBus.emit('availability.updated', { ...avail });
    this.logger.info('repository', 'availability.updated', `Availability ${avail.id} created`);
    return { ...avail };
  }

  getAvailability(userId) {
    return userId
      ? this.store.getAll('availability').filter(a => a.user_id === userId)
      : this.store.getAll('availability');
  }

  getRatings() { return this.store.getAll('ratings').map(r => ({ ...r })); }

  createContract(input) {
    const gigId = validation.requireString(input, 'gig_id');
    const performerId = validation.requireString(input, 'performer_id');
    const venueId = validation.requireString(input, 'venue_id');
    const amount = input.amount !== undefined ? validation.requireNumber(input, 'amount', { min: 0 }) : null;
    const terms = validation.optionalString(input, 'terms', { max: 4000 });
    const contract = { id: id(), gig_id: gigId, performer_id: performerId, venue_id: venueId, terms, amount, status: input.status || 'draft', performer_signed: 0, venue_signed: 0 };
    this.store.create('contracts', contract);
    this.audit('contracts', contract.id, 'created', performerId, null, contract);
    this.eventBus.emit('contract.created', { ...contract });
    this.logger.info('repository', 'contract.created', `Contract ${contract.id} created`);
    return { ...contract };
  }

  acceptApplication(appId) {
    const app = ensureFound(this.store.getById('applications', appId), 'Application not found');
    if (app.status !== 'pending' && app.status !== 'pending_approval') throw new ValidationError('Application cannot be accepted', 'status');
    const gig = ensureFound(this.store.getById('gigs', app.gig_id), 'Gig not found');
    const venue = ensureFound(this.store.getById('venues', gig.venue_id), 'Venue not found');

    const acceptedApp = { ...app, status: 'approved' };
    this.store.update('applications', appId, acceptedApp);
    this.audit('applications', appId, 'accepted', venue.owner_id, app, acceptedApp);
    this.eventBus.emit('application.accepted', { ...acceptedApp });
    this.logger.info('repository', 'application.accepted', `Application ${appId} accepted`);

    const contract = { id: id(), gig_id: gig.id, performer_id: app.user_id, venue_id: venue.id, amount: gig.budget, terms: 'Standard gig terms', status: 'draft', performer_signed: 0, venue_signed: 0 };
    this.store.create('contracts', contract);
    this.audit('contracts', contract.id, 'created', venue.owner_id, null, contract);
    this.eventBus.emit('contract.created', { ...contract });
    this.logger.info('repository', 'contract.created', `Contract ${contract.id} created from application`);

    const filledGig = { ...gig, status: 'filled' };
    this.store.update('gigs', gig.id, filledGig);
    this.audit('gigs', gig.id, 'filled', venue.owner_id, gig, filledGig);
    this.eventBus.emit('gig.filled', { ...filledGig });
    this.logger.info('repository', 'gig.filled', `Gig ${gig.id} filled`);

    return { application: { ...acceptedApp }, contract: { ...contract } };
  }

  declineApplication(appId) {
    const app = ensureFound(this.store.getById('applications', appId), 'Application not found');
    const updated = { ...app, status: 'rejected' };
    this.store.update('applications', appId, updated);
    this.audit('applications', appId, 'rejected', null, app, updated);
    this.eventBus.emit('application.rejected', { ...updated });
    this.logger.info('repository', 'application.rejected', `Application ${appId} rejected`);
    return { ...updated };
  }

  signContract(cid, signerId) {
    validation.requireString({ signerId }, 'signerId');
    const contract = ensureFound(this.store.getById('contracts', cid), 'Contract not found');
    const venue = this.store.getById('venues', contract.venue_id);
    const isPerformer = contract.performer_id === signerId;
    const isVenueOwner = venue && venue.owner_id === signerId;
    if (isPerformer) contract.performer_signed = 1;
    else if (isVenueOwner) contract.venue_signed = 1;
    else throw new ValidationError('Signer is not a party to the contract', 'signer_id');

    const updated = { ...contract };
    if (updated.performer_signed && updated.venue_signed) updated.status = 'signed';
    this.store.update('contracts', cid, updated);
    this.audit('contracts', cid, 'signed', signerId, contract, updated);
    this.eventBus.emit('contract.signed', { ...updated });
    this.logger.info('repository', 'contract.signed', `Contract ${cid} signed`);
    return { ...updated };
  }

  completeContract(cid) {
    const old = ensureFound(this.store.getById('contracts', cid), 'Contract not found');
    if (old.status !== 'signed') throw new ValidationError('Contract must be signed before completion', 'status');
    const updated = { ...old, status: 'completed' };
    this.store.update('contracts', cid, updated);
    this.audit('contracts', cid, 'completed', null, old, updated);
    this.eventBus.emit('contract.completed', { ...updated });
    this.logger.info('repository', 'contract.completed', `Contract ${cid} completed`);
    return { ...updated };
  }

  updateContractStatus(cid, status) {
    const old = ensureFound(this.store.getById('contracts', cid), 'Contract not found');
    const updated = { ...old, status };
    this.store.update('contracts', cid, updated);
    this.audit('contracts', cid, 'status_change', null, old, updated);
    this.eventBus.emit('contract.status_changed', { ...updated });
    this.logger.info('repository', 'contract.status_changed', `Contract ${cid} -> ${status}`);
    return { ...updated };
  }

  createPayment(input) {
    const contractId = input.contract_id ? validation.requireString(input, 'contract_id') : null;
    const amount = validation.requireNumber(input, 'amount', { min: 0 });
    const paidBy = validation.requireString(input, 'paid_by');
    const paidTo = validation.requireString(input, 'paid_to');
    const payment = { id: id(), contract_id: contractId, amount, paid_by: paidBy, paid_to: paidTo, status: 'pending' };
    this.store.create('payments', payment);
    this.audit('payments', payment.id, 'created', paidBy, null, payment);
    this.eventBus.emit('payment.created', { ...payment });
    this.logger.info('repository', 'payment.created', `Payment ${payment.id} created`);
    return { ...payment };
  }

  releasePayment(pid) {
    const old = ensureFound(this.store.getById('payments', pid), 'Payment not found');
    const updated = { ...old, status: 'completed' };
    this.store.update('payments', pid, updated);
    this.audit('payments', pid, 'released', old.paid_by, old, updated);
    this.eventBus.emit('payment.released', { ...updated });
    this.logger.info('repository', 'payment.released', `Payment ${pid} released`);
    return { ...updated };
  }

  getPayments() { return this.store.getAll('payments').map(p => ({ ...p })); }

  createRating(input) {
    const contract = input.contract_id ? ensureFound(this.store.getById('contracts', input.contract_id), 'Contract not found') : null;
    if (input.contract_id && (!contract || contract.status !== 'completed')) throw new ValidationError('Contract must be completed before rating', 'contract_id');
    if (contract) {
      const venue = this.store.getById('venues', contract.venue_id);
      const ownerId = venue ? venue.owner_id : null;
      const allowed = [contract.performer_id, ownerId].filter(Boolean);
      if (!allowed.includes(input.rater_id)) throw new ValidationError('Rater must be a party to the contract', 'rater_id');
    }
    const rater = validation.requireString(input, 'rater_id');
    const ratee = validation.requireString(input, 'ratee_id');
    const score = validation.requireInteger(input, 'score', { min: 1, max: 5 });
    const comment = validation.optionalString(input, 'comment', { max: 2000 });
    const rating = { id: id(), contract_id: input.contract_id || null, rater_id: rater, ratee_id: ratee, score, comment };
    this.store.create('ratings', rating);
    this.eventBus.emit('rating.created', { ...rating });
    this.logger.info('repository', 'rating.created', `Rating ${rating.id} created`);
    return { ...rating };
  }

  getContracts() { return this.store.getAll('contracts').map(c => ({ ...c })); }
  getAllApplications() { return this.store.getAll('applications').map(a => ({ ...a })); }
  getAllGigs() { return this.getGigs(); }

  createModerationCase(input) {
    const targetType = validation.requireOneOf(input, 'targetType', ['message', 'application', 'user', 'contract']);
    const targetId = validation.requireString(input, 'targetId');
    const reason = validation.requireString(input, 'reason', { min: 1, max: 500 });
    const createdBy = input.createdBy != null ? validation.requireString({ createdBy: input.createdBy }, 'createdBy', { max: 128 }) : 'system';
    const caseId = id();
    const modCase = {
      id: caseId,
      targetType,
      targetId,
      reason,
      status: 'flagged',
      createdBy,
      createdAt: now(),
      reviewedBy: null,
      reviewedAt: null,
      notes: []
    };
    this.store.create('moderation', modCase);
    this.audit('moderation', modCase.id, 'created', createdBy, null, modCase);
    this.eventBus.emit('moderation.created', { ...modCase });
    this.logger.info('repository', 'moderation.created', `Moderation case ${modCase.id} created`);
    return { ...modCase };
  }

  getModerationQueue(status) {
    const all = this.store.getAll('moderation');
    return status ? all.filter(c => c.status === status) : all;
  }

  getModerationCase(cid) { return this.store.getById('moderation', cid); }

  updateModerationStatus(cid, { status, reviewedBy, note }) {
    const validStatuses = ['flagged', 'quarantined', 'reviewing', 'released', 'removed', 'restricted'];
    status = validation.requireOneOf({ status }, 'status', validStatuses);
    reviewedBy = reviewedBy != null ? validation.requireString({ reviewedBy }, 'reviewedBy', { max: 128 }) : null;
    const modCase = ensureFound(this.store.getById('moderation', cid), 'Moderation case not found');
    const updated = { ...modCase, status, reviewedBy, reviewedAt: now() };
    if (note) updated.notes = [...modCase.notes, { author: reviewedBy || 'moderator', text: note, at: now() }];
    this.store.update('moderation', cid, updated);
    this.applyModerationAction(updated);
    this.audit('moderation', cid, 'status_change', reviewedBy, modCase, updated);
    this.eventBus.emit('moderation.' + status, { caseId: cid, status, reviewedBy });
    this.logger.info('repository', `moderation.${status}`, `Moderation case ${cid} -> ${status}`);
    return { ...updated };
  }

  addModeratorNote(cid, { author, note }) {
    author = validation.requireString({ author }, 'author', { max: 128 });
    note = validation.requireString({ note }, 'note', { min: 1, max: 2000 });
    const modCase = ensureFound(this.store.getById('moderation', cid), 'Moderation case not found');
    const updated = { ...modCase };
    updated.notes = [...modCase.notes, { author, text: note, at: now() }];
    this.store.update('moderation', cid, updated);
    this.audit('moderation', cid, 'note_added', author, modCase, updated);
    this.eventBus.emit('moderation.note_added', { caseId: cid, author });
    this.logger.info('repository', 'moderation.note_added', `Note added to ${cid}`);
    return { ...updated };
  }

  getModerationTimeline() {
    return this.store.getAll('moderation').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  applyModerationAction(modCase) {
    if (modCase.status === 'quarantined' && modCase.targetType === 'message') {
      const msg = this.store.getById('messages', modCase.targetId);
      if (msg) this.store.update('messages', msg.id, { ...msg, quarantined: 1 });
    }
    if (modCase.status === 'quarantined' && modCase.targetType === 'application') {
      const app = this.store.getById('applications', modCase.targetId);
      if (app) this.store.update('applications', app.id, { ...app, quarantined: 1 });
    }
    if (modCase.status === 'released' && (modCase.targetType === 'message' || modCase.targetType === 'application')) {
      const t = this.store.getById(modCase.targetType + 's', modCase.targetId);
      if (t) this.store.update(modCase.targetType + 's', t.id, { ...t, quarantined: 0 });
    }
    if (modCase.status === 'restricted' && modCase.targetType === 'user') {
      const user = this.store.getById('users', modCase.targetId);
      if (user) this.store.update('users', user.id, { ...user, restricted: 1 });
      this.eventBus.emit('user.restricted', { userId: modCase.targetId });
    }
    if (modCase.status === 'removed') {
      // Mark target as quarantined; permanent removal is manual or follow-up
      const t = this.store.getById(modCase.targetType + 's', modCase.targetId);
      if (t) this.store.update(modCase.targetType + 's', t.id, { ...t, quarantined: 1 });
    }
  }

  export() {
    const state = this.store.load();
    const clone = JSON.parse(JSON.stringify(state));
    // Always strip password hashes and internal metadata from default export
    clone.users = (clone.users || []).map(u => { const c = { ...u }; delete c.password_hash; return c; });
    return clone;
  }

  import(newState, options = {}) {
    if (typeof newState !== 'object' || newState == null || !Array.isArray(newState.users)) {
      throw new ValidationError('Invalid import payload', 'newState');
    }
    if (newState.schemaVersion && newState.schemaVersion !== 1) {
      throw new ValidationError(`Unsupported schema version: ${newState.schemaVersion}`, 'schemaVersion');
    }
    const allowed = ['users', 'venues', 'gigs', 'availability', 'applications', 'messages', 'contracts', 'payments', 'ratings', 'audit_log'];
    if (options.dryRun) return { tables: allowed, records: allowed.reduce((acc, k) => { acc[k] = (newState[k] || []).length; return acc; }, {}) };

    const oldState = this.store.load();
    try {
      allowed.forEach(k => {
        this.store.state[k] = Array.isArray(newState[k]) ? newState[k] : this.store.state[k] || [];
      });
      this.store.save();
    } catch (err) {
      this.store.state = oldState;
      this.logger.error('repository', 'import_failed', `Import rollback: ${err.message}`);
      throw err;
    }
    this.eventBus.emit('database.imported', { tables: allowed });
    this.logger.info('repository', 'database.imported', 'Database imported');
    return { ok: true };
  }
}

function createRepository(options = {}) {
  const config = options.config || require('./config').createConfig();
  const logger = options.logger || require('./logger').createLogger(config);
  const transports = [new MemoryTransport()];
  if (config.eventLogPath) {
    transports.push(new FileTransport(config.eventLogPath));
  }
  if (config.enableHydiAdapter && config.hydeEndpoint) {
    const { HydiAdapter } = require('./events/event-bus');
    transports.push(new HydiAdapter({ endpoint: config.hydeEndpoint }));
  }
  const store = options.store || createStore({
    ...options.storeOptions,
    dataDir: config.dataDir,
    filePath: config.dbPath,
    backupDir: config.backupDir,
    logger,
    onCorruption: (info) => {
      logger.error('persistence', 'corruption_restored', 'Database restored from backup', info);
    }
  });
  const eventBus = options.eventBus || new EventBus(transports);
  const repo = new Repository(store, eventBus, logger);
  return repo;
}

module.exports = { Repository, createRepository };
