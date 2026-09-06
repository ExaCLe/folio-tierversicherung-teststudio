import { expect, type APIRequestContext } from '@playwright/test';
import type { Role } from '../../shared/insurance';

export async function api<T>(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown, role: Role = 'Broker'): Promise<T> {
  const response = await request.fetch(path, { method, ...(data !== undefined ? { data } : {}), headers: { 'x-folio-role': role } });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

export async function apiError(request: APIRequestContext, method: 'POST' | 'PUT' | 'PATCH', path: string, data: unknown, status: number, code: string, role: Role = 'Broker') {
  const response = await request.fetch(path, { method, data, headers: { 'x-folio-role': role } });
  expect(response.status()).toBe(status);
  const body = await response.json();
  expect(body.code).toBe(code);
  expect(body.error).toBeTruthy();
  return body;
}
