import type { User, UserRole } from "@prisma/client";

export type JwtPayload = {
  sub: string;
  employee_id: string;
  role: UserRole;
  sid: string;
};

export type JwtUser = {
  userId: string;
  employeeId: string;
  role: UserRole;
  sessionId: string;
};

export type PublicUser = {
  id: string;
  employee_id: string;
  name: string;
  role: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    employee_id: user.employeeId,
    name: user.name,
    role: user.role.toLowerCase(),
  };
}

export type AuthTokensResponse = {
  access_token: string;
  refresh_token: string;
  user: PublicUser;
};
