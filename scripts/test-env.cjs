require('dotenv/config');

// Toda prueba debe aislar también el registro de control SaaS.
// No reutilizar una PLATFORM_DATABASE_URL externa al ejecutar Jest.
const database = new URL(process.env.DATABASE_URL);
database.pathname = '/vestidor18_test';
process.env.DATABASE_URL = database.toString();
process.env.PLATFORM_DATABASE_URL = database.toString();
process.env.TENANT_DATABASE_URL = database.toString();
