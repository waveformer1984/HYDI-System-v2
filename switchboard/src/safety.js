const PROTECTED_AGE_MAX = 15;

function isProtected(user) {
  return user.age != null && user.age <= PROTECTED_AGE_MAX;
}

function parentApprovalRequired(user) {
  return isProtected(user) && !user.parent_approved;
}

function moderateContent(content) {
  const patterns = [
    /\b(telegram|whatsapp|kik|snapchat)\s*:?\s*\w+/i,
    /\b\d{3}-\d{3}-\d{4}\b/,
    /\b\d{10}\b/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  ];
  const flagged = patterns.some(p => p.test(content));
  return { flagged, reason: flagged ? 'Contains contact information or external platform reference' : 'OK' };
}

function checkApplicationSafety(user, gig) {
  if (parentApprovalRequired(user)) {
    return { allowed: true, status: 'pending_approval', reason: 'Protected account: requires parent approval' };
  }
  if (gig.min_age != null && user.age != null && user.age < gig.min_age) {
    return { allowed: false, status: 'rejected', reason: 'Does not meet minimum age requirement' };
  }
  if (gig.max_age != null && user.age != null && user.age > gig.max_age) {
    return { allowed: false, status: 'rejected', reason: 'Exceeds maximum age requirement' };
  }
  return { allowed: true, status: 'pending', reason: 'Cleared' };
}

function logAndDecideApplication(user, gig, application) {
  const check = checkApplicationSafety(user, gig);
  return check;
}

function logMessage(message) {
  const moderation = moderateContent(message.content);
  const quarantined = moderation.flagged ? 1 : 0;
  return { ...message, quarantined, moderation };
}

module.exports = {
  isProtected,
  parentApprovalRequired,
  moderateContent,
  checkApplicationSafety,
  logAndDecideApplication,
  logMessage,
  PROTECTED_AGE_MAX
};
