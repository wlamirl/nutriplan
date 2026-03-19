import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { users, nutritionists } from '../database/schema';
import {
  IUserRepository,
  INutritionistRepository,
  User,
  Nutritionist,
} from '@nutriplan/domain';

// ─── PgUserRepository ─────────────────────────────────────────────────────────

export class PgUserRepository implements IUserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async create(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const rows = await db
      .insert(users)
      .values({ email: data.email, passwordHash: data.passwordHash, role: data.role })
      .returning();
    return this.toDomain(rows[0]!);
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return {
      id:           row.id,
      email:        row.email,
      passwordHash: row.passwordHash,
      role:         row.role,
      createdAt:    row.createdAt,
    };
  }
}

// ─── PgNutritionistRepository ─────────────────────────────────────────────────

export class PgNutritionistRepository implements INutritionistRepository {
  async findByUserId(userId: string): Promise<Nutritionist | null> {
    const rows = await db
      .select()
      .from(nutritionists)
      .where(eq(nutritionists.userId, userId))
      .limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findById(id: string): Promise<Nutritionist | null> {
    const rows = await db
      .select()
      .from(nutritionists)
      .where(eq(nutritionists.id, id))
      .limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async create(data: Omit<Nutritionist, 'id' | 'createdAt'>): Promise<Nutritionist> {
    const rows = await db
      .insert(nutritionists)
      .values({ userId: data.userId, name: data.name, crn: data.crn, phone: data.phone })
      .returning();
    return this.toDomain(rows[0]!);
  }

  private toDomain(row: typeof nutritionists.$inferSelect): Nutritionist {
    return {
      id:        row.id,
      userId:    row.userId,
      name:      row.name,
      crn:       row.crn   ?? undefined,
      phone:     row.phone ?? undefined,
      createdAt: row.createdAt,
    };
  }
}
