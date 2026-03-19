import bcrypt from 'bcrypt';
import { IPasswordHasher } from '@nutriplan/domain';

export class BcryptPasswordHasher implements IPasswordHasher {
  constructor(private readonly saltRounds = 10) {}

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
