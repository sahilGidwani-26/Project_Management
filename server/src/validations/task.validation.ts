import { z } from "zod";

const bugDetails = z.object({
  severity: z.enum(["Minor", "Major", "Critical"]).default("Major"),
  stepsToReproduce: z.string().max(3000).optional(),
  expectedResult: z.string().max(1000).optional(),
  actualResult: z.string().max(1000).optional(),
  environment: z.string().max(200).optional(),
  foundInVersion: z.string().max(40).optional(),
  fixedInVersion: z.string().max(40).optional(),
});

export const createTaskSchema = z.object({
  body: z.object({
    workspaceId: z.string().min(1),
    projectId: z.string().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    type: z.enum(["Task", "Bug", "Feature", "Improvement"]).default("Task"),
    bugDetails: bugDetails.optional(),
    assigneeIds: z.array(z.string()).optional(),
    status: z.enum(["Backlog", "Todo", "In Progress", "In Review", "Done"]).default("Todo"),
    priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
    startDate: z.string().datetime().optional(),
    dueDate: z.string().datetime().optional(),
    labels: z.array(z.string()).optional(),
    subtasks: z.array(z.string()).optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const updateTaskStatusSchema = z.object({
  body: z.object({
    status: z.enum(["Backlog", "Todo", "In Progress", "In Review", "Done"]),
    order: z.number().optional(),
  }),
  query: z.any(),
  params: z.any(),
});