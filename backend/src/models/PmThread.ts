import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "../db.js";

// A product manager chat. The messages live in the LangGraph checkpointer under
// the same id; this row is just what the chat list needs.
export class PmThread extends Model<InferAttributes<PmThread>, InferCreationAttributes<PmThread>> {
  declare id: string;
  declare title: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PmThread.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "pm_threads" },
);
