import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from "sequelize";
import type { SharedProvider } from "shared";
import { sequelize } from "../db.js";

export class Integration extends Model<InferAttributes<Integration>, InferCreationAttributes<Integration>> {
  declare provider: string;
  declare apiKey: string;
}

Integration.init(
  {
    provider: { type: DataTypes.STRING, primaryKey: true },
    apiKey: { type: DataTypes.STRING, allowNull: false },
  },
  { sequelize, tableName: "integrations" },
);

// The saved API key for a shared service, or null if it isn't connected.
export async function getKey(provider: SharedProvider) {
  const row = await Integration.findByPk(provider);
  return row?.apiKey ?? null;
}
