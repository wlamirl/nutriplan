import { DomainError } from '../errors/DomainError';
import { UserRole } from '../entities/User';
import { IUserRepository, INutritionistRepository } from '../repositories/user.interfaces';
import { IPasswordHasher } from '../services/interfaces';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  userId: string;
  email: string;
  role: UserRole;
  nutritionistId?: string;
}

export class LoginUseCase {
  constructor(
    private readonly userRepo:         IUserRepository,
    private readonly nutritionistRepo: INutritionistRepository,
    private readonly passwordHasher:   IPasswordHasher,
  ) {}

  async execute(req: LoginRequest): Promise<LoginResponse> {
    const user = await this.userRepo.findByEmail(req.email);
    if (!user) {
      // Mensagem genérica para não vazar se o e-mail existe
      throw new DomainError('Credenciais inválidas');
    }

    const valid = await this.passwordHasher.compare(req.password, user.passwordHash);
    if (!valid) {
      throw new DomainError('Credenciais inválidas');
    }

    let nutritionistId: string | undefined;
    if (user.role === 'nutritionist') {
      const nutritionist = await this.nutritionistRepo.findByUserId(user.id);
      nutritionistId = nutritionist?.id;
    }

    return {
      userId: user.id,
      email:  user.email,
      role:   user.role,
      nutritionistId,
    };
  }
}
