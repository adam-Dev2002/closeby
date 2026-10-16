export type Coordinate = { latitude: number; longitude: number };

export type LocationFix = Coordinate & {
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
};

export type DeviceProfile = {
  id: string;
  ownerId: string;
  name: string;
  photoURL: string | null;
  avatarId?: string | null;
  platform: string;
  batteryLevel: number | null;
  location: LocationFix | null;
  sharing: boolean;
  lastSeen: number;
};

export type SpaceMember = {
  uid: string;
  name: string;
  photoURL: string | null;
  avatarId?: string | null;
  canRequestMedia?: boolean;
};

export type SpaceMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number | null;
  pending: boolean;
};

export type SafeZone = {
  id: string;
  name: string;
  description?: string;
  coordinate: Coordinate;
  radius: number;
  color: string;
  enabled: boolean;
};

export type RecordedTrip = {
  id: string;
  startedAt: number;
  endedAt: number;
  points: LocationFix[];
  distanceMeters: number;
};

export type ActivitySample = {
  id: string;
  sessionId: string;
  fix: LocationFix;
  place: string | null;
  distanceMeters: number;
};

export type ActivityEntry = {
  id: string;
  kind: 'move' | 'stop' | 'gap';
  startedAt: number;
  endedAt: number;
  points: LocationFix[];
  distanceMeters: number;
  place: string | null;
  departed: boolean;
};

export type HistoryConsent = { enabled: boolean; generation: string; startedAt: number };

export type EmergencyAudience = 'owner' | 'everyone';

export type SpaceEmergencyAlert = {
  id: string;
  senderId: string;
  senderName: string;
  audience: EmergencyAudience;
  ownerId: string;
  location: LocationFix | null;
  text: string;
  createdAt: number | null;
  pending: boolean;
};
