export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown> | Array<unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: Record<string, unknown> | Array<unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request', details?: Record<string, unknown> | Array<unknown>) {
    super(message, 400, true, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message: string = 'Unauthorized: Missing or invalid credentials',
    details?: Record<string, unknown> | Array<unknown>,
  ) {
    super(message, 401, true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource Not Found') {
    super(message, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict', details?: Record<string, unknown> | Array<unknown>) {
    super(message, 409, true, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message: string = 'Rate limit exceeded: Too Many Requests',
    details?: Record<string, unknown> | Array<unknown>,
  ) {
    super(message, 429, true, details);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 500, false);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message: string = 'Service Unavailable',
    details?: Record<string, unknown> | Array<unknown>,
  ) {
    super(message, 503, true, details);
  }
}
