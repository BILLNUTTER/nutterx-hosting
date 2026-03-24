import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import appsRouter from "./apps.js";
import adminRouter from "./admin.js";
import billingRouter from "./billing.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(appsRouter);
router.use(adminRouter);
router.use(billingRouter);

export default router;
