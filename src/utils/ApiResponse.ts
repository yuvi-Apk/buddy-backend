// Shape of every successful response: res.status(200).json(new ApiResponse(200, data, "..."))
export class ApiResponse<T = unknown> {
  statusCode: number;
  data: T;
  message: string;
  success: boolean;

  constructor(statusCode: number, data: T, message: string) {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
  }
}
