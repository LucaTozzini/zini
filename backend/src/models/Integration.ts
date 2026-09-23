import {
  DataTypes,
  Model,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "../db.js";

export class Integration extends Model<
  InferAttributes<Integration>,
  InferCreationAttributes<Integration>
> {
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
