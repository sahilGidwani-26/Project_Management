import { Request, Response } from "express";
import { Model } from "mongoose";
import { catchAsync } from "./catchAsync";
import { ApiError } from "./ApiError";
import { sendSuccess } from "./ApiResponse";
import { PReq, fail } from "./projectAccess";
import { logActivity } from "../services/projectEvents";

interface Opts {
  model: Model<any>;
  entity: string;
  fields: string[];
  sort?: Record<string, 1 | -1>;
  populate?: any;
  ownerField?: string;
  beforeCreate?: (req: PReq, data: any) => Promise<void> | void;
  afterCreate?: (req: PReq, doc: any) => Promise<void> | void;
  beforeUpdate?: (req: PReq, data: any, doc: any) => Promise<void> | void;
  afterUpdate?: (req: PReq, doc: any, before: any) => Promise<void> | void;
  afterDelete?: (req: PReq, doc: any) => Promise<void> | void;
}

export function makeCrud(o: Opts) {
  const pick = (b: any) => {
    const d: any = {};
    o.fields.forEach((k) => {
      if (b && k in b) d[k] = b[k] === "" ? null : b[k];
    });
    return d;
  };
  const label = (d: any) => d.title || d.name || d.fileName || "";
  const log = (req: Request, action: string, doc: any) => {
    const r = req as PReq;
    return logActivity({
      workspaceId: r.project.workspaceId,
      projectId: r.project._id,
      actorId: req.user!.id,
      action: `${o.entity}_${action}`,
      entity: o.entity,
      metadata: { title: label(doc) },
    });
  };
  const find = async (req: Request) => {
    const doc = await o.model.findOne({ _id: req.params.itemId, projectId: (req as PReq).project._id });
    if (!doc) throw ApiError.notFound(`${o.entity} not found`);
    return doc;
  };
  const notOwner = (req: Request, doc: any) =>
    !!o.ownerField && String(doc[o.ownerField]) !== req.user!.id && (req as PReq).projectRole !== "ADMIN";

  return {
    list: catchAsync(async (req: Request, res: Response) => {
      let query = o.model.find({ projectId: (req as PReq).project._id }).sort(o.sort || { createdAt: -1 });
      if (o.populate) query = query.populate(o.populate);
      return sendSuccess(res, 200, await query, o.entity);
    }),

    create: catchAsync(async (req: Request, res: Response) => {
      const r = req as PReq;
      const data = pick(req.body);
      data.projectId = r.project._id;
      data.workspaceId = r.project.workspaceId;
      data.createdBy = req.user!.id;
      await o.beforeCreate?.(r, data);
      let doc = await o.model.create(data);
      await o.afterCreate?.(r, doc);
      await log(req, "created", doc);
      if (o.populate) doc = await doc.populate(o.populate);
      return sendSuccess(res, 201, doc, `${o.entity} created`);
    }),

    update: catchAsync(async (req: Request, res: Response) => {
      const r = req as PReq;
      const doc = await find(req);
      if (notOwner(req, doc)) return fail(res, "Only the author or a project admin can do that", 403);
      const before = doc.toObject();
      const data = pick(req.body);
      await o.beforeUpdate?.(r, data, doc);
      doc.set(data);
      await doc.save();
      await o.afterUpdate?.(r, doc, before);
      await log(req, "updated", doc);
      const out = o.populate ? await doc.populate(o.populate) : doc;
      return sendSuccess(res, 200, out, `${o.entity} updated`);
    }),

    remove: catchAsync(async (req: Request, res: Response) => {
      const r = req as PReq;
      const doc = await find(req);
      if (notOwner(req, doc)) return fail(res, "Only the author or a project admin can do that", 403);
      await doc.deleteOne();
      await o.afterDelete?.(r, doc);
      await log(req, "deleted", doc);
      return sendSuccess(res, 200, null, `${o.entity} deleted`);
    }),
  };
}