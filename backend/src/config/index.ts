import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load from project root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Database Configuration Harmonization
const pgHost = process.env.PG_HOST || 'localhost';
const pgPort = parseInt(process.env.PG_PORT || '5432', 10);
const pgUser = process.env.PG_USER || 'postgres';
const pgPassword = process.env.PG_PASSWORD || 'postgres';
const pgDatabase = process.env.PG_DATABASE || 'conversational_sql';
const constructedDbUrl = `postgresql://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDatabase}`;
const resolvedDbUrl = process.env.DATABASE_URL || constructedDbUrl;

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  jwt: {
    secret: process.env.JWT_SECRET || 'conversational-sql-jwt-secret-key-development-32chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'conversational-sql-jwt-refresh-secret-development',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  db: {
    url: resolvedDbUrl,
    host: pgHost,
    port: pgPort,
    user: pgUser,
    password: pgPassword,
    database: pgDatabase,
    ssl: process.env.PG_SSL === 'true',
  },
  querySafety: {
    maxExecutionTimeMs: parseInt(process.env.MAX_EXECUTION_TIME_MS || '30000', 10),
    maxRowLimit: parseInt(process.env.MAX_ROW_LIMIT || '1000', 10),
    autoExecuteSelect: process.env.AUTO_EXECUTE_SELECT !== 'false',
    requireConfirmationForMutations: process.env.REQUIRE_CONFIRMATION_FOR_MUTATIONS !== 'false',
  },
  uploads: {
    dir: path.resolve(__dirname, '../../../uploads'),
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
  },
};

/**
 * Validates critical environment configuration at service startup.
 * Prevents insecure placeholder secrets in production mode.
 */
export function validateEnvironment(): void {
  const isProd = config.env === 'production';
  const weakSecretPatterns = [
    'change-in-production',
    'super-secret',
    'conversational-sql-jwt',
    'default',
    '123456',
    'secret',
  ];

  if (isProd) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error(
        'SECURITY VIOLATION: Production requires JWT_SECRET with minimum 32 characters.'
      );
    }
    if (weakSecretPatterns.some(p => (process.env.JWT_SECRET || '').toLowerCase().includes(p))) {
      throw new Error(
        'SECURITY VIOLATION: Insecure default or placeholder JWT_SECRET detected in production.'
      );
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
      throw new Error(
        'SECURITY VIOLATION: Production requires JWT_REFRESH_SECRET with minimum 32 characters.'
      );
    }
    if (weakSecretPatterns.some(p => (process.env.JWT_REFRESH_SECRET || '').toLowerCase().includes(p))) {
      throw new Error(
        'SECURITY VIOLATION: Insecure default or placeholder JWT_REFRESH_SECRET detected in production.'
      );
    }
  }

  // Ensure upload directory exists
  if (!fs.existsSync(config.uploads.dir)) {
    fs.mkdirSync(config.uploads.dir, { recursive: true });
  }
}
