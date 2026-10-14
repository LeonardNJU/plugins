// One status vocabulary for every tracking service. The UI shows
// t(`status.<status>`).

export const STATUSES = [
  'pending', 'info_received', 'in_transit', 'out_for_delivery', 'available_for_pickup',
  'delivered', 'failed', 'exception', 'expired', 'not_found', 'unknown',
];

/** No more polling once a parcel is in one of these. */
export const FINAL_STATUSES = new Set(['delivered', 'expired']);

const FROM_17TRACK = {
  NotFound: 'not_found',
  InfoReceived: 'info_received',
  InTransit: 'in_transit',
  Expired: 'expired',
  AvailableForPickup: 'available_for_pickup',
  OutForDelivery: 'out_for_delivery',
  DeliveryFailure: 'failed',
  Delivered: 'delivered',
  Exception: 'exception',
};

export function from17track(status) {
  return FROM_17TRACK[status] ?? 'unknown';
}

/**
 * DHL's statusCode has only pre-transit, transit, delivered, failure and
 * unknown; "out for delivery" and "ready for pickup" show up in the event's
 * status text or description.
 */
export function fromDhl(code, text = '') {
  const t = String(text || '');
  switch (code) {
    case 'pre-transit': return 'info_received';
    case 'transit':
      if (/out.?for.?delivery|zustellfahrzeug|in zustellung|delivery vehicle/i.test(t)) return 'out_for_delivery';
      if (/pick.?up|abholbereit|ready for collection|packstation|filiale/i.test(t) && /ready|available|bereit|liegt/i.test(t)) return 'available_for_pickup';
      return 'in_transit';
    case 'delivered': return 'delivered';
    case 'failure': return 'failed';
    default: return 'unknown';
  }
}

/** Colour token for a status dot (host theme variables). */
export function statusTone(status) {
  switch (status) {
    case 'delivered': return 'var(--color-success)';
    case 'out_for_delivery':
    case 'available_for_pickup': return 'var(--color-primary)';
    case 'failed':
    case 'exception': return 'var(--color-destructive)';
    case 'expired':
    case 'not_found':
    case 'unknown':
    case 'pending': return 'var(--color-muted-foreground)';
    default: return 'var(--color-info, var(--color-primary))';
  }
}
