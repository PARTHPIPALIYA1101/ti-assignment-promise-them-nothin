export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: {
    code: string;
    details?: unknown;
  };
  timestamp: string;
}

export class ResponseUtil {
  public static success<T>(data: T, message?: string): ApiResponse<T> {
    const res: ApiResponse<T> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
    if (message !== undefined) {
      res.message = message;
    }
    return res;
  }

  public static error(
    message: string,
    code: string = 'INTERNAL_ERROR',
    details?: unknown,
  ): ApiResponse<null> {
    const res: ApiResponse<null> = {
      success: false,
      message,
      error: {
        code,
      },
      timestamp: new Date().toISOString(),
    };
    if (details !== undefined && res.error) {
      res.error.details = details;
    }
    return res;
  }
}
