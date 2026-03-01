// Global test setup
// Set required environment variables for tests
process.env.ENCRYPTION_KEY = "test-encryption-key-for-unit-tests";
process.env.AUTH_SECRET = "test-auth-secret-for-unit-tests";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
