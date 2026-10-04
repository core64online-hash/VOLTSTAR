import type { AuthResult, AuthUser, LoginInput, RegisterInput } from '@voltstar/types';
import { apiUrl } from './api';

const TOKEN_KEY = 'voltstar_token';

/** Токен поточної вкладки, якщо localStorage і cookie недоступні. */
let memoryToken: string | null = null;

function usableToken(value: string | null | undefined): string | null {
  if (!value || value === 'undefined') return null;
  return value;
}

function readCookieToken(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${TOKEN_KEY}=`;
  for (const part of document.cookie.split('; ')) {
    if (!part.startsWith(prefix)) continue;
    const raw = part.slice(prefix.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function tokenCookie(value: string, maxAge: number): void {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Зберігає access-токен у памʼяті сторінки, localStorage і first-party cookie. true, якщо токен непорожній. */
export function saveToken(token: string): boolean {
  if (!usableToken(token)) return false;
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage недоступний — лишається cookie або памʼять */
  }
  try {
    tokenCookie(token, 900);
  } catch {
    /* cookie недоступна */
  }
  return true;
}

/** Повертає збережений токен або null. Спочатку памʼять сторінки, потім localStorage, потім cookie. */
export function getToken(): string | null {
  const memory = usableToken(memoryToken);
  if (memory) return memory;
  try {
    const stored = usableToken(localStorage.getItem(TOKEN_KEY));
    if (stored) return stored;
  } catch {
    /* localStorage недоступний */
  }
  return usableToken(readCookieToken());
}

/** Видаляє токен (вихід) з памʼяті сторінки, localStorage і cookie. */
export function clearToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    tokenCookie('', 0);
  } catch {
    /* ignore */
  }
}

export class AuthRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: unknown };
    if (typeof data.message === 'string') return data.message;
    if (Array.isArray(data.message)) return data.message.join(', ');
  } catch {
    /* тіло не JSON */
  }
  return `Помилка запиту (${res.status})`;
}

/** Реєстрація користувача. */
export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const res = await fetch(apiUrl('/accounts/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Логін за email + паролем. */
export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const res = await fetch(apiUrl('/accounts/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Профіль поточного користувача за токеном. */
export async function fetchMe(token: string): Promise<AuthUser> {
  const res = await fetch(apiUrl('/accounts/me'), {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new AuthRequestError(await parseError(res), res.status);
  return res.json();
}

/** Запит листа зі скиданням паролю (відповідь однакова для будь-якого email). */
export async function requestPasswordReset(email: string, locale: string): Promise<void> {
  const res = await fetch(apiUrl('/accounts/password/forgot'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, locale }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

/** Новий пароль за токеном із листа. */
export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await fetch(apiUrl('/accounts/password/reset'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}
