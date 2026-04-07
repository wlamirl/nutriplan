import { DomainError }      from '../errors/DomainError';
import { Patient }           from '../entities/Patient';
import { IPatientRepository } from '../repositories/interfaces';
import { IUserRepository }   from '../repositories/user.interfaces';
import { IPasswordHasher }   from '../services/interfaces';

export interface RegisterPatientRequest {
  nutritionistId: string;
  name:                string;
  birthDate:           string;   // ISO "YYYY-MM-DD"
  sex:                 'M' | 'F';
  heightCm:            number;
  activityLevel:       Patient['activityLevel'];
  restrictions:        Array<{ type: Patient['restrictions'][0]['type']; description: string }>;
  culturalPreferences?: string;
  routineNotes?:        string;
  dislikedFoods?:       string[];
  /** Quando fornecido, cria um usuário com role 'patient' e vincula ao paciente */
  email?:    string;
  password?: string;
}

export interface RegisterPatientResponse {
  patient: Patient;
  /** Preenchido apenas quando email/password foram fornecidos */
  userId?: string;
}

export class RegisterPatientUseCase {
  constructor(
    private readonly patientRepo:   IPatientRepository,
    private readonly userRepo:      IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
  ) {}

  async execute(req: RegisterPatientRequest): Promise<RegisterPatientResponse> {
    // Validação: email e password devem ser fornecidos juntos
    if ((req.email && !req.password) || (!req.email && req.password)) {
      throw new DomainError('Email e senha devem ser fornecidos juntos');
    }

    let userId: string | undefined;

    if (req.email && req.password) {
      const existing = await this.userRepo.findByEmail(req.email);
      if (existing) {
        throw new DomainError('E-mail já cadastrado');
      }

      const passwordHash = await this.passwordHasher.hash(req.password);
      const user = await this.userRepo.create({
        email:        req.email,
        passwordHash,
        role:         'patient',
      });
      userId = user.id;
    }

    const patient = await this.patientRepo.save({
      id:                  '',
      nutritionistId:      req.nutritionistId,
      userId,
      name:                req.name,
      birthDate:           new Date(req.birthDate),
      sex:                 req.sex,
      heightCm:            req.heightCm,
      activityLevel:       req.activityLevel,
      restrictions:        req.restrictions.map(r => ({ id: '', ...r })),
      culturalPreferences: req.culturalPreferences,
      routineNotes:        req.routineNotes,
      dislikedFoods:       req.dislikedFoods ?? [],
    });

    return { patient, userId };
  }
}
