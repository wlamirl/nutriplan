import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterNutritionistUseCase } from '../RegisterNutritionistUseCase';
import { DomainError } from '../../errors/DomainError';
import type { IUserRepository, INutritionistRepository } from '../../repositories/user.interfaces';
import type { IPasswordHasher } from '../../services/interfaces';
import type { User, Nutritionist } from '../../entities/User';

describe('RegisterNutritionistUseCase', () => {
  let userRepo: IUserRepository;
  let nutritionistRepo: INutritionistRepository;
  let passwordHasher: IPasswordHasher;
  let useCase: RegisterNutritionistUseCase;

  const mockUser: User = {
    id: 'user-1',
    email: 'ana@clinica.com',
    passwordHash: 'hashed-pw',
    role: 'nutritionist',
    createdAt: new Date(),
  };

  const mockNutritionist: Nutritionist = {
    id: 'nutri-1',
    userId: 'user-1',
    name: 'Ana Paula',
    crn: 'CRN-3 12345',
    createdAt: new Date(),
  };

  beforeEach(() => {
    userRepo = {
      findByEmail: vi.fn(),
      findById:    vi.fn(),
      create:      vi.fn(),
    };
    nutritionistRepo = {
      findByUserId: vi.fn(),
      findById:     vi.fn(),
      create:       vi.fn(),
    };
    passwordHasher = {
      hash:    vi.fn(),
      compare: vi.fn(),
    };
    useCase = new RegisterNutritionistUseCase(userRepo, nutritionistRepo, passwordHasher);
  });

  it('deve registrar nutricionista e retornar ids + email + nome', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(null);
    vi.mocked(passwordHasher.hash).mockResolvedValue('hashed-pw');
    vi.mocked(userRepo.create).mockResolvedValue(mockUser);
    vi.mocked(nutritionistRepo.create).mockResolvedValue(mockNutritionist);

    const result = await useCase.execute({
      name:     'Ana Paula',
      email:    'ana@clinica.com',
      password: 'senha123',
      crn:      'CRN-3 12345',
    });

    expect(result).toEqual({
      userId:         'user-1',
      nutritionistId: 'nutri-1',
      email:          'ana@clinica.com',
      name:           'Ana Paula',
    });
  });

  it('deve fazer hash da senha antes de persistir', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(null);
    vi.mocked(passwordHasher.hash).mockResolvedValue('hashed-pw');
    vi.mocked(userRepo.create).mockResolvedValue(mockUser);
    vi.mocked(nutritionistRepo.create).mockResolvedValue(mockNutritionist);

    await useCase.execute({ name: 'Ana', email: 'ana@clinica.com', password: 'senha123' });

    expect(passwordHasher.hash).toHaveBeenCalledWith('senha123');
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'hashed-pw', role: 'nutritionist' })
    );
  });

  it('deve lançar DomainError quando e-mail já está cadastrado', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(mockUser);

    await expect(
      useCase.execute({ name: 'Ana', email: 'ana@clinica.com', password: 'senha123' })
    ).rejects.toThrow(new DomainError('E-mail já cadastrado'));

    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(userRepo.create).not.toHaveBeenCalled();
    expect(nutritionistRepo.create).not.toHaveBeenCalled();
  });

  it('deve criar o nutritionist com o userId do user criado', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(null);
    vi.mocked(passwordHasher.hash).mockResolvedValue('hashed-pw');
    vi.mocked(userRepo.create).mockResolvedValue(mockUser);
    vi.mocked(nutritionistRepo.create).mockResolvedValue(mockNutritionist);

    await useCase.execute({ name: 'Ana', email: 'ana@clinica.com', password: 'senha123' });

    expect(nutritionistRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', name: 'Ana' })
    );
  });
});
