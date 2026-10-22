export const MOBILE_DEVICE_SCOPES = [
  "conversation:read",
  "conversation:create",
  "conversation:advance",
  "conversation:manage",
  "schedule:read",
  "schedule:manage",
  "schedule:trigger",
  "schedule:cancel",
  "artifact:read",
] as const;
export interface MobileConnectionStatus {
  configured: boolean;
  connectionError?: string;
  endpoint?: string;
  protocolVersion?: string;
  enabled?: boolean;
  taskChannelReady?: boolean;
  owner?: { ownerId: string; spaceId: string; label: string; online: boolean };
  claims?: {
    id: string;
    deviceLabel: string;
    verificationPhrase: string;
    expiresAt: string;
    state: string;
  }[];
  devices?: {
    deviceId: string;
    deviceLabel: string;
    scopes: string[];
    expiresAt: string;
    revoked: boolean;
    createdAt: string;
    lastSeenAt: string;
    grantRevision: string;
  }[];
  allowedScopes?: string[];
}
export interface MobileConnectionInvitation {
  invitation: string;
  expiresAt: string;
  endpoint: string;
}
export type MobileConnectionCommand =
  | { action: "status" }
  | { action: "save"; endpoint: string; managementToken: string }
  | { action: "enabled"; enabled: boolean }
  | { action: "invite" }
  | {
      action: "approve";
      id: string;
      verificationPhrase: string;
      scopes: string[];
    }
  | { action: "reject"; id: string }
  | { action: "revoke"; id: string };
export interface MobileConnectionResult {
  status: MobileConnectionStatus;
  invitation?: MobileConnectionInvitation;
}
