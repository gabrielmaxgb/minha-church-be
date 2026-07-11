import type {
  CareRequest,
  CareRequestStatus,
  CareRequestType,
  Member,
} from '@prisma/client';

export interface CareRequestMemberSummary {
  id: string;
  name: string;
}

export interface CareRequestRecipientResponse {
  id: string;
  name: string;
  roles: string[];
}

export interface CareRequestResponse {
  id: string;
  churchId: string;
  type: CareRequestType;
  status: CareRequestStatus;
  message: string | null;
  requester: CareRequestMemberSummary;
  recipient: CareRequestMemberSummary;
  viewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type CareRequestWithMembers = CareRequest & {
  requester: Pick<Member, 'id' | 'name'>;
  recipient: Pick<Member, 'id' | 'name'>;
};

export function toCareRequestResponse(
  request: CareRequestWithMembers,
): CareRequestResponse {
  return {
    id: request.id,
    churchId: request.churchId,
    type: request.type,
    status: request.status,
    message: request.message,
    requester: {
      id: request.requester.id,
      name: request.requester.name,
    },
    recipient: {
      id: request.recipient.id,
      name: request.recipient.name,
    },
    viewedAt: request.viewedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export const CARE_REQUEST_TYPE_LABELS: Record<CareRequestType, string> = {
  counseling: 'Aconselhamento',
  visit: 'Visita',
};
