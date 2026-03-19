export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
    // Fix instanceof checks when compiling to CommonJS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
