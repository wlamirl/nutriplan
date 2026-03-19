import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['nutritionist', 'admin']);

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role:         userRoleEnum('role').notNull().default('nutritionist'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

export const nutritionists = pgTable('nutritionists', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  crn:       text('crn').unique(),   // Conselho Regional de Nutricionistas
  phone:     text('phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
