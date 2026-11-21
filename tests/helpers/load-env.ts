import path from 'node:path';
import dotenv from 'dotenv';

let loaded = false;

export function loadTestEnv(): void {
  if (loaded) {
    return;
  }
  dotenv.config({
    path: path.resolve(process.cwd(), '.env.local'),
    quiet: true,
  });
  loaded = true;
}
