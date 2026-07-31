const { parseJson } = require('./util');

const R = 6371000; // Earth radius in meters

function toRad(deg) { return deg * Math.PI / 180; }

function haversine(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  const intersection = [...setA].filter(x => setB.has(x));
  return intersection.length / (setA.size + setB.size - intersection.length);
}

function overlapsFully(userWindows, gigStart, gigEnd) {
  const gs = new Date(gigStart).getTime();
  const ge = new Date(gigEnd).getTime();
  if (isNaN(gs) || isNaN(ge)) return false;
  return userWindows.some(w => {
    const ws = new Date(w.start_time).getTime();
    const we = new Date(w.end_time).getTime();
    return !isNaN(ws) && !isNaN(we) && ws <= gs && we >= ge;
  });
}

function overlapsPartially(userWindows, gigStart, gigEnd) {
  const gs = new Date(gigStart).getTime();
  const ge = new Date(gigEnd).getTime();
  if (isNaN(gs) || isNaN(ge)) return false;
  return userWindows.some(w => {
    const ws = new Date(w.start_time).getTime();
    const we = new Date(w.end_time).getTime();
    return !isNaN(ws) && !isNaN(we) && ws < ge && we > gs;
  });
}

function availabilityScore(userWindows, gig) {
  if (!userWindows || !userWindows.length) return { score: 0, reason: 'No availability provided' };
  if (overlapsFully(userWindows, gig.start_time, gig.end_time)) {
    return { score: 1, reason: 'Fully available during gig window' };
  }
  if (overlapsPartially(userWindows, gig.start_time, gig.end_time)) {
    return { score: 0.5, reason: 'Partially available during gig window' };
  }
  return { score: 0, reason: 'No availability overlap' };
}

function locationScore(user, gig) {
  const d = haversine(user.latitude, user.longitude, gig.latitude, gig.longitude);
  if (d == null) return { score: 0, reason: 'Missing location data' };
  const km = d / 1000;
  if (km <= 25) return { score: 1, reason: `Within 25km (${km.toFixed(1)}km)` };
  if (km <= 50) return { score: 0.6, reason: `Within 50km (${km.toFixed(1)}km)` };
  if (km <= 100) return { score: 0.3, reason: `Within 100km (${km.toFixed(1)}km)` };
  return { score: 0, reason: `Over 100km away (${km.toFixed(1)}km)` };
}

function skillScore(user, gig) {
  const userSkills = parseJson(user.skills, []);
  const required = parseJson(gig.required_skills, []);
  const score = jaccard(userSkills, required);
  const matched = userSkills.filter(s => required.map(r => r.toLowerCase()).includes(s.toLowerCase())).length;
  return {
    score,
    reason: required.length
      ? `${matched} of ${required.length} required skills matched`
      : 'No required skills specified'
  };
}

function ratingScore(user, ratings) {
  const userRatings = ratings.filter(r => r.ratee_id === user.id);
  if (!userRatings.length) return { score: 0.5, reason: 'No ratings yet' };
  const avg = userRatings.reduce((a, b) => a + b.score, 0) / userRatings.length;
  return { score: (avg - 1) / 4, reason: `Average rating ${avg.toFixed(2)} / 5` };
}

function experienceScore(user, contracts) {
  const completed = contracts.filter(c => c.performer_id === user.id && c.status === 'completed').length;
  const score = Math.min(completed, 10) / 10;
  return { score, reason: `${completed} completed gigs` };
}

function reliabilityScore(user, applications) {
  const userApps = applications.filter(a => a.user_id === user.id);
  if (!userApps.length) return { score: 0.8, reason: 'No application history' };
  const bad = userApps.some(a => a.no_show || a.late);
  if (bad) return { score: 0, reason: 'Prior no-show or late record' };
  return { score: 1, reason: 'Clean reliability record' };
}

function matchUserForGig(user, gig, context = {}) {
  const factors = [
    { name: 'skill_match', weight: 0.30, ...skillScore(user, gig) },
    { name: 'availability', weight: 0.20, ...availabilityScore(context.availability || [], gig) },
    { name: 'location', weight: 0.15, ...locationScore(user, gig) },
    { name: 'ratings', weight: 0.15, ...ratingScore(user, context.ratings || []) },
    { name: 'experience', weight: 0.10, ...experienceScore(user, context.contracts || []) },
    { name: 'response_reliability', weight: 0.10, ...reliabilityScore(user, context.applications || []) }
  ];
  const total = factors.reduce((acc, f) => acc + f.score * f.weight, 0);
  return { total: Number(total.toFixed(4)), factors };
}

function rankUserForGigs(user, gigs, context = {}) {
  return gigs
    .map(gig => ({ gig, ...matchUserForGig(user, gig, context) }))
    .sort((a, b) => b.total - a.total);
}

function rankApplicationsForGig(gig, applications, users, context = {}) {
  return applications
    .map(app => {
      const user = users.find(u => u.id === app.user_id) || {};
      const score = matchUserForGig(user, gig, context);
      return { application: app, user, ...score };
    })
    .sort((a, b) => b.total - a.total);
}

module.exports = {
  matchUserForGig,
  rankUserForGigs,
  rankApplicationsForGig,
  haversine,
  jaccard
};
