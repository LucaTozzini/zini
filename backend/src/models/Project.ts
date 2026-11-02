import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";

// A repo zini works on, with the Linear team whose issues are its work. Each team
// belongs to one project at most. The team's name and key are read from Linear. Its
// Google Search Console property is set when Search Console is connected.
export class Project extends Model<InferAttributes<Project>, InferCreationAttributes<Project>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare githubRepo: string;
  declare linearTeamId: string;
  declare googleSearchConsoleSite: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Project.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    githubRepo: { type: DataTypes.STRING, allowNull: false, unique: true },
    linearTeamId: { type: DataTypes.STRING, allowNull: false, unique: true },
    googleSearchConsoleSite: { type: DataTypes.STRING, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "projects" },
);

// The column every per-project table has.
export const projectIdColumn = {
  type: DataTypes.INTEGER,
  allowNull: false,
  references: { model: Project, key: "id" },
  onDelete: "CASCADE",
} as const;
