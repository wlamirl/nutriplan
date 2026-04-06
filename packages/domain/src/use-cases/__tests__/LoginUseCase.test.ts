import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginUseCase } from '../LoginUseCase';
import { DomainError } from '../../errors/DomainError';
import type { IUserRepository, INutritionistRepository } from '../../repositories/user.interfaces';
import type { IPasswordHasher } from '../../services/interfaces';
import type { User, Nutritionist } from '../../entities/User';

describe('LoginUseCase', () => {
  let userRepo: IUserRepository;
  let nutritionistRepo: INutritionistRepository;
  let passwordHasher: IPasswordHasher;
  let useCase: LoginUseCase;

  const mockUser: User = {
    id:           'user-1',
    email:        'ana@teste.com',
    passwordHash: 'hashed-pw',
    role:         'nutritionist',
    createdAt:    new Date(),
  };

  const mockNutritionist: Nutritionist = {
    id:        'nutri-1',
    userId:    'user-1',
    name:      'Ana Paula',
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
    useCase = new LoginUseCase(userRepo, nutritionistRepo, passwordHasher);
  });

  it('deve retornar userId, email, role e nutritionistId no login bem-sucedido', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(passwordHasher.compare).mockResolvedValue(true);
    vi.mocked(nutritionistRepo.findByUserId).mockResolvedValue(mockNutritionist);

    const result = await useCase.execute({ email: 'ana@teste.com', password: 'senha123' });

    expect(result).toEqual({
      userId:         'user-1',
      email:          'ana@teste.com',
      role:           'nutritionist',
      nutritionistId: 'nutri-1',
    });
    expect(passwordHasher.compare).toHaveBeenCalledWith('senha123', 'hashed-pw');
  });

  it('deve lançar DomainError com mensagem genérica quando e-mail não existe', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(null);

    await expect(
      useCase.execute({ email: 'inexistente@teste.com', password: 'senha123' })
    ).rejects.toThrow(new DomainError('Credenciais inválidas'));

    // Não deve chamar compare para não vazar timing
    expect(passwordHasher.compare).not.toHaveBeenCalled();
  });

  it('deve lançar DomainError com mensagem genérica quando senha está incorreta', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(passwordHasher.compare).mockResolvedValue(false);

    await expect(
      useCase.execute({ email: 'ana@teste.com', password: 'senha-errada' })
    ).rejects.toThrow(new DomainError('Credenciais inválidas'));
  });

  it('não deve buscar nutritionistId para usuários com role admin', async () => {
    const adminUser: User = { ...mockUser, role: 'admin' };
    vi.mocked(userRepo.findByEmail).mockResolvedValue(adminUser);
    vi.mocked(passwordHasher.compare).mockResolvedValue(true);

    const result = await useCase.execute({ email: 'ana@teste.com', password: 'senha123' });

    expect(result.nutritionistId).toBeUndefined();
    expect(nutritionistRepo.findByUserId).not.toHaveBeenCalled();
  });

  it('deve retornar nutritionistId undefined se nutricionista não for encontrado no banco', async () => {
    vi.mocked(userRepo.findByEmail).mockResolvedValue(mockUser);
    vi.mocked(passwordHasher.compare).mockResolvedValue(true);
    vi.mocked(nutritionistRepo.findByUserId).mockResolvedValue(null);

    const result = await useCase.execute({ email: 'ana@teste.com', password: 'senha123' });

    expect(result.nutritionistId).toBeUndefined();
  });
});
