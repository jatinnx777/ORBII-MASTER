// ORBII Verified-Helper reward + fraud engine (client surface).
//
// The authoritative logic lives server-side in sql/33_reward_fraud_engine.sql.
// These modules collect signals, run the client-only checks (geofence arrival,
// route verification) and forward everything to the server, which alone decides
// eligibility, the fraud score, the reward amount and the payout hold.

export { REWARD, GEOFENCE, MOVEMENT, formatPaise } from './config';
export { RewardService, type RewardRow } from './RewardService';
export { FraudDetectionService, getDeviceId } from './FraudDetectionService';
export { TrustScoreService } from './TrustScoreService';
export { PaymentQueueService, type QueueSummary } from './PaymentQueueService';
export { createGeofence, type Geofence } from './GeofenceArrivalService';
export { createRouteVerifier, type RouteVerifier } from './RouteVerificationService';
