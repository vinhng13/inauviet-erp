import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USERNAME = 5;
const MAX_PER_IP = 30;

/**
 * Slows down password guessing: after 5 wrong passwords for one username, or 30 failures from one
 * IP address, within 15 minutes, further attempts are refused until the window passes.
 * In memory: restarting the API resets it, which is fine for one server.
 */
@Injectable()
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  /** Seconds until the next attempt is allowed, or 0. */
  retryAfter(username: string, ip: string): number {
    const now = Date.now();
    const wait = (key: string, max: number) => {
      const recent = this.recent(key, now);
      return recent.length >= max ? Math.ceil((recent[0] + WINDOW_MS - now) / 1000) : 0;
    };
    return Math.max(wait(`u:${username}`, MAX_PER_USERNAME), wait(`ip:${ip}`, MAX_PER_IP));
  }

  fail(username: string, ip: string): void {
    const now = Date.now();
    for (const key of [`u:${username}`, `ip:${ip}`]) this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(username: string): void {
    this.failures.delete(`u:${username}`);
  }

  /** Forget all failures (tests). */
  reset(): void {
    this.failures.clear();
  }

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }
}
