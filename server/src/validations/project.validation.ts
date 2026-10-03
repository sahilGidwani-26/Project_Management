import { z } from "zod";

const dateStr = z.string().refine((v) => !isNaN(Date.parse(v)), "Invalid date").nullable().optional();
const status = z.enum(["Planning", "Active", "On Hold", "Completed", "Cancelled", "Archived"]);
const priority = z.enum(["Low", "Medium", "High", "Urgent"]);
const role = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

const fields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().max(2000).nullable().optional(),
  managerId: z.string().nullable().optional(),
  status: status.optional(),
  priority: priority.optional(),
  startDate: dateStr,
  endDate: dateStr,
  color: z.string().max(20).nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  coverImage: z.string().url().max(500).nullable().optional().or(z.literal("")),
  category: z.string().max(60).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(15).optional(),
  clientName: z.string().max(120).nullable().optional(),
  budget: z.number().min(0).nullable().optional(),
  currency: z.string().max(5).optional(),
  visibility: z.enum(["public", "private"]).optional(),
};

const datesOk = (b: { startDate?: string | null; endDate?: string | null }) =>
  !b.startDate || !b.endDate || Date.parse(b.endDate) >= Date.parse(b.startDate);

export const createProjectSchema = z.object({
  body: z
    .object({
      workspaceId: z.string().min(1),
      ...fields,
      memberIds: z.array(z.string()).max(200).optional(),
      templateId: z.string().optional(),
    })
    .refine(datesOk, { message: "End date must be after start date", path: ["endDate"] }),
  query: z.any(),
  params: z.any(),
});

export const updateProjectSchema = z.object({
  body: z.object({ ...fields }).partial().refine(datesOk, { message: "End date must be after start date", path: ["endDate"] }),
  query: z.any(),
  params: z.any(),
});

export const memberSchema = z.object({
  body: z.object({ userId: z.string().min(1).optional(), role }),
  query: z.any(),
  params: z.any(),
});

export const bulkSchema = z.object({
  body: z.object({
    workspaceId: z.string().min(1),
    ids: z.array(z.string()).min(1).max(100),
    action: z.enum(["archive", "restore", "status", "delete"]).optional(),
    status: status.optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const timeEntrySchema = z.object({
  body: z.object({
    taskId: z.string().nullable().optional(),
    minutes: z.number().int().min(1).max(60 * 24),
    note: z.string().max(500).nullable().optional(),
    date: dateStr,
    billable: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.any(),
});