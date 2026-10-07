import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DataTypes, Sequelize } from "sequelize";

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
  // sync creates new tables but doesn't add columns to existing installations.
  const schema = sequelize.getQueryInterface();
  if ((await schema.showAllTables()).includes("oauth_connections")) {
    const columns = await schema.describeTable("oauth_connections");
    if (!columns.earliestRefreshAt) {
      await schema.addColumn("oauth_connections", "earliestRefreshAt", { type: DataTypes.DATE, allowNull: true });
    }
  }
  console.log(`sqlite ready at ${storage}`);
}
