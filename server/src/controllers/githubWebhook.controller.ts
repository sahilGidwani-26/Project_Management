import crypto from "crypto";
import { Request, Response } from "express";
import { GithubIntegration, GithubDelivery } from "../models/GithubIntegration";
import { processEvent } from "../services/githubSync";

/**
 * POST /api/integrations/github/webhook/:integrationId
 * Public endpoint (GitHub cannot log in) protected by the per-integration HMAC secret.
 */
export async function handleGithubWebhook(req: Request, res: Response) {
  try {
    const { integrationId } = req.params;
    if (!/^[a-f\d]{24}$/i.test(integrationId)) return res.status(404).json({ success: false, message: "Not found" });

    const integration: any = await GithubIntegration.findById(integrationId).select("+secret");
    if (!integration) return res.status(404).json({ success: false, message: "Not found" });

    const raw: Buffer | undefined = (req as any).rawBody;
    if (!raw) return res.status(400).json({ success: false, message: "Set the webhook Content type to application/json" });

    // Verify X-Hub-Signature-256 (timing-safe)
    const received = Buffer.from(String(req.get("x-hub-signature-256") || ""));
    const expected = Buffer.from("sha256=" + crypto.createHmac("sha256", integration.secret).update(raw).digest("hex"));
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return res.status(401).json({ success: false, message: "Invalid signature" });
    }

    if (!integration.enabled) return res.status(200).json({ success: true, ignored: "integration disabled" });

    // GitHub retries failed deliveries: process each delivery id once
    const delivery = String(req.get("x-github-delivery") || "");
    if (delivery) {
      try {
        await GithubDelivery.create({ deliveryId: `${integrationId}:${delivery}` });
      } catch (e: any) {
        if (e?.code === 11000) return res.status(200).json({ success: true, duplicate: true });
        throw e;
      }
    }

    const event = String(req.get("x-github-event") || "");
    const payload = req.body;
    if (String(payload?.repository?.full_name || "").toLowerCase() !== integration.repo) {
      return res.status(202).json({ success: true, ignored: "different repository" });
    }

    // Answer GitHub right away (it waits ~10s), do the work in the background
    res.status(202).json({ success: true, received: true });
    void processEvent(integration, event, payload, req.app.get("io")).catch((e) =>
      console.error("[github] processing failed:", e)
    );
  } catch (e) {
    console.error("[github] webhook error:", e);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Webhook error" });
  }
}