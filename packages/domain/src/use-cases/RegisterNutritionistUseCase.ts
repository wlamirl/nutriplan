import { DomainError } from '../errors/DomainError';
import { IUserRepository, INutritionistRepository } from '../repositories/user.interfaces';
import { IPasswordHasher } from '../services/interfaces';

export interface RegisterNutritionistRequest {
  name: string;
  email: string;
  password: string;
  crn?: string;
  phone?: string;
}

export interface RegisterNutritionistResponse {
  userId: string;
  nutritionistId: string;
  email: string;
  name: string;
}

export class RegisterNutritionistUseCase {
  constructor(
    private readonly userRepo:         IUserRepository,
    private readonly nutritionistRepo: INutritionistRepository,
    private readonly passwordHasher:   IPasswordHasher,
  ) {}

  async execute(req: RegisterNutritionistRequest): Promise<RegisterNutritionistResponse> {
    const existing = await this.userRepo.findByEmail(req.email);
    if (existing) {
      throw new DomainError('E-mail já cadastrado');
    }

    const passwordHash = await this.passwordHasher.hash(req.password);

    const user = await this.userRepo.create({
      email: req.email,
      passwordHash,
      role: 'nutritionist',
    });

    const nutritionist = await this.nutritionistRepo.create({
      userId: user.id,
      name:   req.name,
      crn:    req.crn,
      phone:  req.phone,
    });

    return {
      userId:          user.id,
      nutritionistId:  nutritionist.id,
      email:           user.email,
      name:            nutritionist.name,
    };
  }
}
