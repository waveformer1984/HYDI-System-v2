const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const scoring = require('./scoring');
const safety = require('./safety');
const diagnostics = require('./diagnostics');
const { requestIdMiddleware, createRateLimiter, errorHandler } = require('./middleware');

function send(res, data) { res.json(data); }

function h(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function createApp(repository, config, logger) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(express.static('public'));

  if (config && config.rateLimit) {
    app.use(createRateLimiter(config));
  }

  app.get('/health', h((req, res) => send(res, { ok: true, service: 'switchboard', version: '0.1.0', requestId: req.requestId })));

  app.get('/diagnostics', h((req, res) => {
    const data = config ? diagnostics.collect(repository, config) : { ok: false };
    send(res, data);
  }));

  app.post('/users', h(async (req, res) => {
    const user = await repository.createUser(req.body);
    send(res, user);
  }));

  app.get('/users/:id', h((req, res) => {
    const user = repository.getUser(req.params.id);
    if (!user) throw new (require('./errors').NotFoundError)('User not found');
    send(res, user);
  }));

  app.put('/users/:id', h(async (req, res) => {
    const user = repository.updateUser(req.params.id, req.body);
    if (!user) throw new (require('./errors').NotFoundError)('User not found');
    send(res, user);
  }));

  app.post('/users/:id/parent-approve', h((req, res) => {
    send(res, repository.approveParent(req.params.id, req.body.parent_email));
  }));

  app.get('/users', h((req, res) => send(res, repository.getUsers())));

  app.post('/venues', h((req, res) => {
    send(res, repository.createVenue(req.body));
  }));

  app.get('/venues', h((req, res) => send(res, repository.getVenues())));

  app.post('/gigs', h((req, res) => {
    send(res, repository.createGig(req.body));
  }));

  app.get('/gigs', h((req, res) => {
    const q = req.query.q;
    send(res, q ? repository.searchGigs(q) : repository.getGigs());
  }));

  app.get('/gigs/:id', h((req, res) => {
    const gig = repository.getGig(req.params.id);
    if (!gig) throw new (require('./errors').NotFoundError)('Gig not found');
    send(res, gig);
  }));

  app.post('/gigs/:id/apply', h((req, res) => {
    const gig = repository.getGig(req.params.id);
    if (!gig) throw new (require('./errors').NotFoundError)('Gig not found');
    const user = repository.getUser(req.body.user_id);
    if (!user) throw new (require('./errors').NotFoundError)('User not found');

    const check = safety.checkApplicationSafety(user, gig);
    if (!check.allowed) throw new (require('./errors').ValidationError)(check.reason);

    const moderation = safety.moderateContent(req.body.note || '');
    const app = repository.createApplication({
      gig_id: gig.id,
      user_id: user.id,
      note: req.body.note,
      status: check.status,
      parent_approved: user.parent_approved,
      quarantined: moderation.flagged ? 1 : 0
    });

    if (moderation.flagged) {
      repository.createModerationCase({ targetType: 'application', targetId: app.id, reason: moderation.reason });
    }

    safety.logAndDecideApplication(user, gig, app);
    send(res, { application: app, statusReason: check.reason });
  }));

  app.get('/gigs/:id/applications', h((req, res) => {
    const gig = repository.getGig(req.params.id);
    if (!gig) throw new (require('./errors').NotFoundError)('Gig not found');
    const applications = repository.getApplicationsForGig(gig.id);
    const users = repository.getUsers();
    const context = {
      availability: repository.getAvailability(),
      ratings: repository.getRatings(),
      contracts: repository.getContracts(),
      applications: repository.getAllApplications()
    };
    const ranked = scoring.rankApplicationsForGig(gig, applications, users, context);
    send(res, ranked);
  }));

  app.post('/applications/:id/accept', h((req, res) => {
    send(res, repository.acceptApplication(req.params.id));
  }));

  app.post('/applications/:id/decline', h((req, res) => {
    send(res, repository.declineApplication(req.params.id));
  }));

  app.post('/contracts/:id/sign', h((req, res) => {
    send(res, repository.signContract(req.params.id, req.body.user_id));
  }));

  app.post('/contracts/:id/complete', h((req, res) => {
    send(res, repository.completeContract(req.params.id));
  }));

  app.get('/contracts', h((req, res) => send(res, repository.getContracts())));

  app.post('/payments', h((req, res) => {
    send(res, repository.createPayment(req.body));
  }));

  app.post('/payments/:id/release', h((req, res) => {
    send(res, repository.releasePayment(req.params.id));
  }));

  app.get('/payments', h((req, res) => send(res, repository.getPayments())));

  app.post('/ratings', h((req, res) => {
    send(res, repository.createRating(req.body));
  }));

  app.post('/messages', h((req, res) => {
    const moderation = safety.moderateContent(req.body.content || '');
    const msg = repository.createMessage({ ...req.body, quarantined: moderation.flagged ? 1 : 0 });
    if (moderation.flagged) {
      repository.createModerationCase({ targetType: 'message', targetId: msg.id, reason: moderation.reason });
    }
    const moderated = safety.logMessage(msg);
    send(res, moderated);
  }));

  app.get('/messages/:user1/:user2', h((req, res) => {
    send(res, repository.getMessages(req.params.user1, req.params.user2));
  }));

  app.get('/match/gigs/:userId', h((req, res) => {
    const user = repository.getUser(req.params.userId);
    if (!user) throw new (require('./errors').NotFoundError)('User not found');
    const gigs = repository.getGigs().filter(g => g.status === 'open');
    const context = {
      availability: repository.getAvailability(user.id),
      ratings: repository.getRatings(),
      contracts: repository.getContracts(),
      applications: repository.getAllApplications()
    };
    const ranked = scoring.rankUserForGigs(user, gigs, context);
    send(res, ranked);
  }));

  app.get('/match/applications/:gigId', h((req, res) => {
    const gig = repository.getGig(req.params.gigId);
    if (!gig) throw new (require('./errors').NotFoundError)('Gig not found');
    const applications = repository.getApplicationsForGig(gig.id);
    const users = repository.getUsers();
    const context = {
      availability: repository.getAvailability(),
      ratings: repository.getRatings(),
      contracts: repository.getContracts(),
      applications: repository.getAllApplications()
    };
    const ranked = scoring.rankApplicationsForGig(gig, applications, users, context);
    send(res, ranked);
  }));

  app.post('/auth/login', h(async (req, res) => {
    const { email, password } = req.body;
    const users = repository.getUsers();
    const user = users.find(u => u.email === email);
    if (!user) throw new (require('./errors').ValidationError)('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new (require('./errors').ValidationError)('Invalid credentials');
    send(res, user);
  }));

  if (!config || (config.featureFlags && config.featureFlags.export !== false)) {
    app.get('/sync/export', h((req, res) => send(res, repository.export())));
  }

  if (!config || (config.featureFlags && config.featureFlags.sync !== false)) {
    app.post('/sync/import', h((req, res) => {
      const dry = req.query.dry === 'true';
      send(res, repository.import(req.body, { dryRun: dry }));
    }));
  }

  app.get('/moderation/queue', h((req, res) => {
    send(res, repository.getModerationQueue(req.query.status));
  }));

  app.get('/moderation/:id', h((req, res) => {
    const c = repository.getModerationCase(req.params.id);
    if (!c) throw new (require('./errors').NotFoundError)('Moderation case not found');
    send(res, c);
  }));

  app.post('/moderation/:id/quarantine', h((req, res) => {
    send(res, repository.updateModerationStatus(req.params.id, { ...req.body, status: 'quarantined' }));
  }));

  app.post('/moderation/:id/release', h((req, res) => {
    send(res, repository.updateModerationStatus(req.params.id, { ...req.body, status: 'released' }));
  }));

  app.post('/moderation/:id/remove', h((req, res) => {
    send(res, repository.updateModerationStatus(req.params.id, { ...req.body, status: 'removed' }));
  }));

  app.post('/moderation/:id/notes', h((req, res) => {
    send(res, repository.addModeratorNote(req.params.id, req.body));
  }));

  app.get('/moderation/timeline', h((req, res) => {
    send(res, repository.getModerationTimeline());
  }));

  app.use(errorHandler(logger || { error: () => {} }));

  return app;
}

module.exports = { createApp };
