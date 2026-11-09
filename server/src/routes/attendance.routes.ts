import { RequestHandler, Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import * as at from "../controllers/attendance.controller";
import * as lv from "../controllers/leave.controller";

const router = Router();
router.use(requireAuth);

/** Loads the person's access in the workspace, then needs ALL the listed permissions. */
const need = (...perms: string[]): RequestHandler[] => [loadWorkspaceRole, requirePermission(...perms)];
const W = "/workspace/:workspaceId";

/* ---- everybody with attendance access ---- */
router.get(`${W}/settings`, ...need("attendance.view"), at.getSettingsCtl);
router.get(`${W}/holidays`, ...need("attendance.view"), at.listHolidays);
router.get(`${W}/today`, ...need("attendance.view"), at.getToday);
router.get(`${W}/me`, ...need("attendance.view"), at.myMonth);
router.post(`${W}/check-in`, ...need("attendance.mark"), at.checkIn);
router.post(`${W}/check-out`, ...need("attendance.mark"), at.checkOut);

/* ---- team views (admin side) ---- */
router.get(`${W}/live`, ...need("attendance.team"), at.liveBoard);
router.get(`${W}/team`, ...need("attendance.team"), at.teamSummary);
router.get(`${W}/matrix`, ...need("attendance.team"), at.monthMatrix);
router.get(`${W}/employee/:userId`, ...need("attendance.team"), at.employeeDetail);

/* ---- corrections ---- */
router.put(`${W}/records`, ...need("attendance.manage"), at.editRecord);
router.delete(`${W}/records`, ...need("attendance.manage"), at.deleteRecord);

/* ---- settings and holidays ---- */
router.put(`${W}/settings`, ...need("attendance.settings"), at.updateSettings);
router.post(`${W}/holidays`, ...need("attendance.settings"), at.addHolidays);
router.delete(`${W}/holidays/:holidayId`, ...need("attendance.settings"), at.deleteHoliday);
router.get(`${W}/tracking`, ...need("attendance.settings"), at.trackingList);
router.put(`${W}/members/:memberId/tracking`, ...need("attendance.settings"), at.setTracking);

/* ---- download (your own report needs attendance.view, everybody's needs attendance.export, checked inside) ---- */
router.get(`${W}/export`, loadWorkspaceRole, requireAnyPermission("attendance.export", "attendance.view"), at.exportReport);

/* ---- leave ---- */
router.get(`${W}/leave/types`, ...need("leave.view"), lv.listTypes);
router.post(`${W}/leave/types`, ...need("attendance.settings"), lv.createType);
router.patch(`${W}/leave/types/:typeId`, ...need("attendance.settings"), lv.updateType);
router.delete(`${W}/leave/types/:typeId`, ...need("attendance.settings"), lv.deleteType);
router.get(`${W}/leave/balance`, ...need("leave.view"), lv.myBalance);
router.get(`${W}/leave/requests`, ...need("leave.view"), lv.listRequests); // ?scope=all is checked inside (leave.approve)
router.post(`${W}/leave/requests`, ...need("leave.request"), lv.createRequest);
router.post(`${W}/leave/requests/:requestId/cancel`, ...need("leave.view"), lv.cancelRequest);
router.post(`${W}/leave/requests/:requestId/review`, ...need("leave.approve"), lv.reviewRequest);

export default router;