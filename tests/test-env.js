// Credenziali degli account di test per le aree cameriere/cucina (vedi
// .env.test, non committato). Import indipendente da playwright.config.js
// perché ogni worker Playwright è un processo Node separato.
import { config } from "dotenv";

config({ path: ".env.test" });

export const TEST_WAITER = {
  email: process.env.TEST_WAITER_EMAIL,
  password: process.env.TEST_WAITER_PASSWORD,
};

export const TEST_KITCHEN = {
  email: process.env.TEST_KITCHEN_EMAIL,
  password: process.env.TEST_KITCHEN_PASSWORD,
};
