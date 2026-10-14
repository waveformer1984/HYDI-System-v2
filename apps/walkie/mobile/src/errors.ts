import { ApiError } from './api';

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'network':
        return 'Cannot reach the Walkie server. Check your connection.';
      case 'unauthenticated':
        return 'Your sign-in has expired. Please sign in again.';
      case 'invite_invalid':
        return 'That invite code does not work. It may be used up, expired or mistyped.';
      case 'channel_full':
        return 'That channel is full.';
      case 'profile_required':
        return 'Choose a display name first.';
      case 'owner_only':
        return 'Only the channel owner can do that.';
      case 'invalid_ticket':
        return 'That sign-in code has expired or was already used. Run owner-login again.';
      case 'guest_not_allowed':
        return 'Guests cannot do that. Ask the channel owner.';
      case 'rate_limited':
        return 'Too many attempts. Wait a minute and try again.';
      case 'not_found':
        return 'That channel is no longer available to you.';
      default:
        return `Something went wrong (${err.code}).`;
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}
