import dotenv from 'dotenv';
import path from 'path';

// Load from project root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

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
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/conversational_sql',
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'conversational_sql',
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
