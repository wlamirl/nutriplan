export type UserRole = 'nutritionist' | 'patient' | 'admin';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
}

export interface Nutritionist {
  id: string;
  userId: string;
  name: string;
  crn?: string;
  phone?: string;
  createdAt: Date;
}
