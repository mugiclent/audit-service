// Infrastructure config — excluded from unit test coverage (see vitest.config.ts)
import Joi from 'joi';

// Two valid configurations:
//   Production (Infisical): DB_PASSWORD + RABBITMQ_USER + RABBITMQ_PASSWORD
//     → config/index.ts builds the pgbouncer connection string
//   Local dev (.env):       DATABASE_URL + RABBITMQ_URL
//     → config/index.ts uses them directly (no pgbouncer in local network)
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: Joi.number().default(8101),

  DATABASE_URL:      Joi.string().uri().optional(),
  DB_PASSWORD:       Joi.string().when('DATABASE_URL', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),

  RABBITMQ_URL:      Joi.string().uri().optional(),
  RABBITMQ_USER:     Joi.string().when('RABBITMQ_URL', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  RABBITMQ_PASSWORD: Joi.string().when('RABBITMQ_URL', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
});

const { error, value } = schema.validate(process.env, { allowUnknown: true });

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = value as {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL?: string;
  DB_PASSWORD?: string;
  RABBITMQ_URL?: string;
  RABBITMQ_USER?: string;
  RABBITMQ_PASSWORD?: string;
};
