import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Sequelize } from "sequelize";

export const storage = process.env.DB_PATH ?? "data/zini.sqlite";
mkdirSync(dirname(storage), { recursive: true });

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage,
  logging: false,
});

export async function initDb() {
  await sequelize.authenticate();
  await sequelize.sync();
  console.log(`sqlite ready at ${storage}`);
}
