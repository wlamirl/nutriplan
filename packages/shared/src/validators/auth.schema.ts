import { z } from 'zod';

export const RegisterSchema = z.object({
  name:     z.string().min(2).max(150),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
  crn:      z.string().max(20).optional(),
  phone:    z.string().max(20).optional(),
});

export const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput    = z.infer<typeof LoginSchema>;
