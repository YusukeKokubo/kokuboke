/**
 * store が投げる素のエラー。HTTP の番号は知らない。
 * 番号への翻訳は server/index.ts の onError が担う。
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404)
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409)
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, 413)
  }
}
