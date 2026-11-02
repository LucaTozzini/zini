import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";
import { projectIdColumn } from "./Project.js";

export class DevelopmentVariable extends Model<
  InferAttributes<DevelopmentVariable>,
  InferCreationAttributes<DevelopmentVariable>
> {
  declare projectId: number;
  declare name: string;
  declare value: string;
}
DevelopmentVariable.init(
  {
    projectId: { ...projectIdColumn, primaryKey: true },
    name: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, tableName: "development_variables" },
);
