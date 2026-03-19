import { User, Nutritionist } from '../entities/User';

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'createdAt'>): Promise<User>;
}

export interface INutritionistRepository {
  findByUserId(userId: string): Promise<Nutritionist | null>;
  findById(id: string): Promise<Nutritionist | null>;
  create(data: Omit<Nutritionist, 'id' | 'createdAt'>): Promise<Nutritionist>;
}
