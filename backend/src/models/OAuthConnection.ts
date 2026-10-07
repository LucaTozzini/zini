import {
  DataTypes,
  Model,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "../db.js";

// A service zini is signed in to with OAuth, e.g. "chatgpt": the client id the service
// issued zini, and the current tokens. Each refresh replaces both tokens. API keys you
// paste are integrations instead (see Integration).
export class OAuthConnection extends Model<
  InferAttributes<OAuthConnection>,
  InferCreationAttributes<OAuthConnection>
> {
  declare provider: string;
  declare clientId: string;
  declare accessToken: string;
  declare refreshToken: string;
  // Kept as a hint for the next sign-in.
  declare idToken: string;
  declare expiresAt: Date;
  declare earliestRefreshAt: Date | null;
  // Who signed in, to show in Settings.
  declare email: string | null;
}

OAuthConnection.init(
  {
    provider: { type: DataTypes.STRING, primaryKey: true },
    clientId: { type: DataTypes.STRING, allowNull: false },
    accessToken: { type: DataTypes.TEXT, allowNull: false },
    refreshToken: { type: DataTypes.TEXT, allowNull: false },
    idToken: { type: DataTypes.TEXT, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    earliestRefreshAt: { type: DataTypes.DATE, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },
  },
  { sequelize, tableName: "oauth_connections" },
);
