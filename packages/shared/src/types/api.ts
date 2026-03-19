/** Formato padrão de resposta de sucesso: { data, meta } */
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** Formato padrão de resposta de erro */
export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

/** Meta de paginação usada em listagens */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: PaginationMeta & Record<string, unknown>;
}

/** Query params comuns de paginação */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}
