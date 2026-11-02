/** 合同统一响应信封：{ code, data, error, message } */
export interface ApiResponseEnvelope<T = unknown> {
  code: number;
  data: T;
  error: string | null;
  message: string;
}
