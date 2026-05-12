function routeEvent(event) {
  switch(event.type) {
    case 'error':
      return { action: 'send_to_ai', priority: 'high' };
    case 'task':
      return { action: 'queue_worker', priority: 'normal' };
    case 'info':
      return { action: 'log_only', priority: 'low' };
    default:
      return { action: 'discard', priority: 'none' };
  }
}

module.exports = { routeEvent };
