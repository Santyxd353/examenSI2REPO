require('dotenv/config');
process.env.NODE_ENV = 'test';

// Nest aborta el proceso por defecto ante errores de arranque. En Jest deben
// propagarse como excepciones para conservar el diagnóstico y cerrar fixtures.
const { NestFactory } = require('@nestjs/core');
const createNest = NestFactory.create.bind(NestFactory);
NestFactory.create = (module, options) => createNest(module, { ...options, abortOnError: false });

// Toda prueba debe aislar también el registro de control SaaS.
// No reutilizar una PLATFORM_DATABASE_URL externa al ejecutar Jest.
const database = new URL(process.env.DATABASE_URL);
database.pathname = '/vestidor18_test';
process.env.DATABASE_URL = database.toString();
process.env.PLATFORM_DATABASE_URL = database.toString();
process.env.TENANT_DATABASE_URL = database.toString();
