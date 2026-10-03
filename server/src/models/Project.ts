import { Schema, model, Document, Types } from "mongoose";

export const PROJECT_STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled", "Archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type ProjectRole = "ADMIN" | "MEMBER" | "VIEWER";

export interface IProject extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  managerId?: Types.ObjectId;
  members: Types.ObjectId[];
  memberRoles: { userId: Types.ObjectId; role: ProjectRole }[];
  status: ProjectStatus;
  previousStatus?: ProjectStatus;
  priority: Priority;
  startDate?: Date;
  endDate?: Date;
  color: string;
  icon?: string;
  coverImage?: string;
  category?: string;
  tags: string[];
  clientName?: string;
  budget?: number;
  currency: string;
  visibility: "public" | "private";
  favoritedBy: Types.ObjectId[];
  progress: number;
  archivedAt?: Date;
  dueSoonSentAt?: Date;
  overdueSentAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, index: true },
    description: String,
    managerId: { type: Schema.Types.ObjectId, ref: "User" },
    members: [{ type: Schema.Types.ObjectId, ref: "User" }],
    memberRoles: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        role: { type: String, enum: ["ADMIN", "MEMBER", "VIEWER"], default: "MEMBER" },
      },
    ],
    status: { type: String, enum: PROJECT_STATUSES, default: "Planning" },
    previousStatus: { type: String, enum: PROJECT_STATUSES },
    priority: { type: String, enum: ["Low", "Medium", "High", "Urgent"], default: "Medium" },
    startDate: Date,
    endDate: Date,
    color: { type: String, default: "#6366F1" },
    icon: String,
    coverImage: String,
    category: String,
    tags: [{ type: String, trim: true }],
    clientName: String,
    budget: Number,
    currency: { type: String, default: "USD" },
    visibility: { type: String, enum: ["public", "private"], default: "public" },
    favoritedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    progress: { type: Number, default: 0, min: 0, max: 100 },
    archivedAt: Date,
    dueSoonSentAt: Date,
    overdueSentAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

projectSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });
projectSchema.index({ workspaceId: 1, status: 1 });

export const Project = model<IProject>("Project", projectSchema);