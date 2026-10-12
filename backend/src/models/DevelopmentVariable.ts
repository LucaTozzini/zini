import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";

export class DevelopmentVariable extends Model<InferAttributes<DevelopmentVariable>, InferCreationAttributes<DevelopmentVariable>> {
  declare repository: string;
  declare name: string;
  declare value: string;
}
DevelopmentVariable.init({
  repository: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.TEXT, allowNull: false },
}, { sequelize, tableName: "development_variables" });
