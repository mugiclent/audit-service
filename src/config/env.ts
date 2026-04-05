// Infrastructure config — excluded from unit test coverage (see vitest.config.ts)
import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: Joi.number().default(8101),
  DB_PASSWORD:       Joi.string().required(),
  RABBITMQ_USER:     Joi.string().required(),
  RABBITMQ_PASSWORD: Joi.string().required(),
});

const { error, value } = schema.validate(process.env, { allowUnknown: true });

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = value as {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DB_PASSWORD: string;
  RABBITMQ_USER: string;
  RABBITMQ_PASSWORD: string;
};
